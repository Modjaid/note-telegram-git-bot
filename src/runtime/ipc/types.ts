import type {
  InboundMessengerMessage,
  OutboundMessengerMessage,
} from "../../messenger/types.js";
import type { RagReconcileStats } from "../../rag/types.js";

/** Gateway → agent worker IPC request (P2-T08). */
export type AgentIpcRequest =
  | { type: "ping" }
  | {
      type: "dialog";
      sessionId?: string;
      message: InboundMessengerMessage;
    }
  | {
      type: "longPost";
      text: string;
    }
  | { type: "ragReconcileAll" }
  | { type: "ragReconcilePaths"; paths: string[] }
  | { type: "ragIndexFile"; relativePath: string }
  | { type: "ragFindSimilar"; query: string; limit?: number };

export type AgentIpcResponse =
  | { ok: true; type: "pong"; workerVersion: string }
  | {
      ok: true;
      type: "dialog";
      sessionId?: string;
      replies: OutboundMessengerMessage[] | null;
    }
  | {
      ok: true;
      type: "longPost";
      fileName: string;
      shortDescription: string;
      indexedRelativePath: string;
      tags: string[];
      wikilinks: string[];
    }
  | { ok: true; type: "ragReconcile"; stats: RagReconcileStats }
  | { ok: true; type: "ragFindSimilar"; files: string[] }
  | { ok: false; error: string };

export const DEFAULT_AGENT_WORKER_PORT = 3710;
export const DEFAULT_IPC_TIMEOUT_MS = 120_000;
/** Full vault reconcile can take many minutes on large repos. */
export const RAG_RECONCILE_ALL_TIMEOUT_MS = 600_000;
