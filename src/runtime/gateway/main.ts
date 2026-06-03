/**
 * Gateway process (Q4): Telegram long polling, MessengerHandler, daily capture,
 * Git push triggers, RAG reconcile hooks. Does not run long ADK/LLM work inline.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { GitWriteService } from "../../git/write-service.js";
import { MessengerHandler } from "../../messenger/handler.js";
import { CommandRegistry } from "../../messenger/command-registry.js";
import { TelegramBotApi } from "../../messenger/telegram-api.js";
import { TelegramLongPoller } from "../../messenger/telegram-poller.js";
import {
  CONTAINER_RAG,
  CONTAINER_USER_REPO,
  ntbCommandsDir,
} from "../../paths/index.js";
import { NoteCaptureService } from "../../note-log/capture.js";
import { createRagHooks } from "../../rag/hooks.js";
import { createRagService } from "../../rag/service.js";
import { IpcLongPostClient } from "./long-post-client.js";
import { runContainerBootstrap } from "../bootstrap.js";
import { loadRuntimeEnv } from "../env.js";
import { startGatewayHealthServer, type HealthSnapshot } from "../health-server.js";
import { AgentIpcClient } from "../ipc/client.js";
import { holdProcessOpen } from "../keep-alive.js";
import {
  GatewayAgentBridge,
  type HandlerMode,
} from "./agent-bridge.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function getVersion(): string {
  const pkg = JSON.parse(
    readFileSync(join(packageRoot, "package.json"), "utf8"),
  ) as { version: string };
  return pkg.version;
}

export async function runGateway(): Promise<void> {
  const version = getVersion();
  console.log(`note-agent-gateway v${version}`);
  console.log(`UserRepo mount: ${CONTAINER_USER_REPO}`);
  console.log(`RAG mount: ${CONTAINER_RAG}`);

  const env = loadRuntimeEnv();
  const ipc = new AgentIpcClient({ port: env.agentWorkerPort });

  let handlerMode: HandlerMode = "NoteCapture";
  let telegramPolling = false;
  let telegramLastError: string | undefined;

  let health: HealthSnapshot = {
    status: "starting",
    gateway: true,
    bootstrapComplete: false,
  };

  startGatewayHealthServer(env.gatewayHealthPort, () => health);

  console.log("Bootstrap: git sync and repo layout...");
  const bootstrap = await runContainerBootstrap(env);
  console.log(bootstrap.gitMessage);
  if (bootstrap.scaffoldCommitMessage) {
    console.log(bootstrap.scaffoldCommitMessage);
  }

  const rag = createRagHooks({
    userRepoDir: env.userRepoDir,
    ragDir: env.ragDir,
    env,
    packageRoot,
  });
  const ragService = createRagService({ env, packageRoot });

  console.log("RAG: reconciling index after git sync...");
  try {
    await rag.reconcileAll?.();
  } catch (error) {
    console.warn(
      `RAG reconcile on startup failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const gitWriter = new GitWriteService({
    repoDir: env.userRepoDir,
    branch: env.gitBranch,
  });

  let workerReachable = false;
  let workerVersion: string | undefined;
  let workerError: string | undefined;
  for (let attempt = 1; attempt <= 15; attempt++) {
    try {
      const pong = await ipc.ping();
      workerReachable = true;
      workerVersion = pong.workerVersion;
      console.log(`Agent worker reachable (v${pong.workerVersion}).`);
      break;
    } catch (error) {
      workerError =
        error instanceof Error ? error.message : String(error);
      if (attempt < 15) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  if (!workerReachable) {
    console.warn(`Agent worker not reachable: ${workerError ?? "unknown"}`);
  }

  const noteCapture = new NoteCaptureService({
    userRepoDir: env.userRepoDir,
    gitWriter,
    longPostClient: workerReachable ? new IpcLongPostClient(ipc) : undefined,
    onAfterWrite: async (paths) => {
      await ragService.reconcilePaths(paths);
    },
  });
  await noteCapture.ensureRegionLoaded();

  const commandRegistry = new CommandRegistry(ntbCommandsDir(env.userRepoDir));
  await commandRegistry.reload();

  const telegramApi = new TelegramBotApi({ botToken: env.telegramBotToken });

  const agentBridge = new GatewayAgentBridge({
    ipc,
    commandRegistry,
    noteCapture,
    onModeChange: (mode) => {
      handlerMode = mode;
    },
    onDialogTimeout: async (message) => {
      await telegramApi.sendOutbound(message);
    },
  });

  const handler = new MessengerHandler({
    allowedUserIds: [env.allowedTelegramUserId],
    agent: agentBridge,
  });

  const poller = new TelegramLongPoller({
    api: telegramApi,
    handler,
    deliver: (message) => telegramApi.sendOutbound(message),
    onPollError: (error) => {
      telegramLastError = error.message;
      console.warn(`Telegram poll error: ${error.message}`);
      health = {
        ...health,
        telegram: {
          polling: telegramPolling,
          handlerMode,
          lastError: telegramLastError,
        },
      };
    },
  });

  health = {
    status: workerReachable ? "ok" : "degraded",
    gateway: true,
    bootstrapComplete: true,
    gitMessage: bootstrap.gitMessage,
    worker: {
      reachable: workerReachable,
      version: workerVersion,
      error: workerError,
    },
    telegram: {
      polling: false,
      handlerMode,
    },
  };

  await poller.start();
  telegramPolling = true;
  health = {
    ...health,
    telegram: { polling: true, handlerMode },
  };
  console.log("Telegram long polling started.");
  console.log(
    `Gateway ready. Handler mode: ${handlerMode}. Health: GET /health`,
  );

  const shutdown = async (signal: string) => {
    console.log(`Gateway received ${signal}; stopping Telegram poll...`);
    await poller.stop();
    console.log("Pushing UserRepo if needed...");
    const result = await gitWriter.pushIfNeeded();
    console.log(result.message);
    process.exit(0);
  };
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  holdProcessOpen();
}

runGateway().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
