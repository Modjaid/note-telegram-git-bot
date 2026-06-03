/**
 * Gateway process (Q4): Telegram long polling, MessengerHandler, daily capture,
 * Git push triggers, RAG reconcile hooks. Does not run long ADK/LLM work inline.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { GitWriteService } from "../../git/write-service.js";
import { CONTAINER_RAG, CONTAINER_USER_REPO } from "../../paths/index.js";
import { runContainerBootstrap } from "../bootstrap.js";
import { loadRuntimeEnv } from "../env.js";
import { startGatewayHealthServer, type HealthSnapshot } from "../health-server.js";
import { AgentIpcClient } from "../ipc/client.js";
import { holdProcessOpen } from "../keep-alive.js";

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
  };

  const shutdown = async (signal: string) => {
    console.log(`Gateway received ${signal}; pushing UserRepo if needed...`);
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

  console.log(
    "Gateway ready (Telegram + handler wiring in Phase 3). Health: GET /health",
  );
  holdProcessOpen();
}

runGateway().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
