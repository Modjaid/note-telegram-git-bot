import type { AgentIpcRequest, AgentIpcResponse } from "../ipc/types.js";
import type { RuntimeEnv } from "../env.js";
import {
  getWorkerRagService,
  runRagReconcileAll,
  runRagReconcilePaths,
} from "./rag-runtime.js";

export function createRagReconcileAllHandler(
  env: RuntimeEnv,
): () => Promise<AgentIpcResponse> {
  return async () => {
    try {
      const stats = await runRagReconcileAll(env);
      return { ok: true, type: "ragReconcile", stats };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
  };
}

export function createRagReconcilePathsHandler(
  env: RuntimeEnv,
): (
  body: Extract<AgentIpcRequest, { type: "ragReconcilePaths" }>,
) => Promise<AgentIpcResponse> {
  return async (body) => {
    try {
      const stats = await runRagReconcilePaths(env, body.paths);
      return { ok: true, type: "ragReconcile", stats };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
  };
}

export function createRagIndexFileHandler(
  env: RuntimeEnv,
): (
  body: Extract<AgentIpcRequest, { type: "ragIndexFile" }>,
) => Promise<AgentIpcResponse> {
  return async (body) => {
    try {
      const stats = await getWorkerRagService(env).reconcilePaths([
        body.relativePath,
      ]);
      return { ok: true, type: "ragReconcile", stats };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
  };
}

export function createRagFindSimilarHandler(
  env: RuntimeEnv,
): (
  body: Extract<AgentIpcRequest, { type: "ragFindSimilar" }>,
) => Promise<AgentIpcResponse> {
  return async (body) => {
    try {
      const files = await getWorkerRagService(env).findSimilarFiles(
        body.query,
        body.limit ?? 5,
      );
      return { ok: true, type: "ragFindSimilar", files };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
  };
}
