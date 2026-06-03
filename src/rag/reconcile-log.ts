import type { RagReconcileStats } from "./types.js";

const MAX_ERROR_LINES = 20;

/** Log reconcile results (gateway/worker). */
export function logRagReconcileStats(
  stats: RagReconcileStats,
  prefix = "RAG reconcile",
): void {
  console.log(
    `${prefix}: indexed=${stats.indexed} reindexed=${stats.reindexed} removed=${stats.removed} skipped=${stats.skipped}`,
  );
  const errors = stats.errors;
  if (errors.length === 0) {
    return;
  }
  for (const err of errors.slice(0, MAX_ERROR_LINES)) {
    console.warn(`RAG reconcile error: ${err}`);
  }
  if (errors.length > MAX_ERROR_LINES) {
    console.warn(
      `RAG reconcile: ${errors.length - MAX_ERROR_LINES} more error(s) omitted`,
    );
  }
}
