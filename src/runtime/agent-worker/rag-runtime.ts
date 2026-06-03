import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRagService, type RagService } from "../../rag/service.js";
import { logRagReconcileStats } from "../../rag/reconcile-log.js";
import type { RagReconcileStats } from "../../rag/types.js";
import type { RuntimeEnv } from "../env.js";

const packageRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

let sharedRagService: RagService | null = null;

export function getWorkerRagService(env: RuntimeEnv): RagService {
  sharedRagService ??= createRagService({ env, packageRoot });
  return sharedRagService;
}

export async function runRagReconcileAll(env: RuntimeEnv): Promise<RagReconcileStats> {
  const service = getWorkerRagService(env);
  const stats = await service.reconcileAll();
  logRagReconcileStats(stats);
  return stats;
}

export async function runRagReconcilePaths(
  env: RuntimeEnv,
  paths: string[],
): Promise<RagReconcileStats> {
  const service = getWorkerRagService(env);
  return service.reconcilePaths(paths);
}

/** Reset singleton (tests). */
export function resetWorkerRagForTests(): void {
  sharedRagService = null;
}
