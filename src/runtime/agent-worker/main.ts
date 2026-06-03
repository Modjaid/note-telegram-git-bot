/**
 * Agent worker process (Q4): Google ADK runtime for slash dialogs, /agent,
 * long-post pipeline, and command authoring. Invoked by the gateway over IPC (P2-T08).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadRuntimeEnv } from "../env.js";
import { holdProcessOpen } from "../keep-alive.js";
import { startAgentIpcServer } from "../ipc/server.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function getVersion(): string {
  const pkg = JSON.parse(
    readFileSync(join(packageRoot, "package.json"), "utf8"),
  ) as { version: string };
  return pkg.version;
}

export async function runAgentWorker(): Promise<void> {
  const version = getVersion();
  console.log(`note-agent-worker v${version}`);

  const env = loadRuntimeEnv();
  if (!env.llmApiKey) {
    console.warn(
      "LLM_API_KEY not set; dialog and embedding calls will fail until configured.",
    );
  } else {
    console.log(
      `LLM provider ${env.llm.providerId} (rag=${env.llm.ragModelId}, dialogue=${env.llm.dialogueModelId}).`,
    );
  }

  startAgentIpcServer({
    port: env.agentWorkerPort,
    workerVersion: version,
  });

  console.log(
    `Agent worker ready. IPC on 127.0.0.1:${env.agentWorkerPort} (ADK in Phase 5/7).`,
  );
  holdProcessOpen();
}

runAgentWorker().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
