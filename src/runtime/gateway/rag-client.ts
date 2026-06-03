import { logRagReconcileStats } from "../../rag/reconcile-log.js";
import type { AgentIpcClient } from "../ipc/client.js";

/**
 * Gateway-side RAG triggers (P2-T08): embeddings run in the agent worker only.
 */
export class GatewayRagClient {
  readonly #ipc: AgentIpcClient;
  readonly #workerReachable: () => boolean;

  constructor(ipc: AgentIpcClient, workerReachable: () => boolean) {
    this.#ipc = ipc;
    this.#workerReachable = workerReachable;
  }

  async reconcileAll(): Promise<void> {
    if (!this.#workerReachable()) {
      console.warn("RAG reconcile skipped: agent worker not reachable.");
      return;
    }
    console.log("RAG: reconciling index via agent worker...");
    const stats = await this.#ipc.ragReconcileAll();
    logRagReconcileStats(stats, "RAG reconcile (worker)");
  }

  async reconcilePaths(paths: string[]): Promise<void> {
    if (!this.#workerReachable() || paths.length === 0) {
      return;
    }
    const stats = await this.#ipc.ragReconcilePaths(paths);
    if (stats.errors.length > 0) {
      logRagReconcileStats(stats, "RAG reconcile after write");
    }
  }
}
