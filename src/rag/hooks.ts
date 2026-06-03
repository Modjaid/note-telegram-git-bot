import type { RuntimeEnv } from "../runtime/env.js";
import { keywordSimilarIndexedFiles } from "./keyword-search.js";
import { logRagReconcileStats } from "./reconcile-log.js";
import { createRagService, type RagService } from "./service.js";

export interface RagIndexHooks {
  findSimilarFiles(query: string, limit?: number): Promise<string[]>;
  indexFile(relativePath: string): Promise<void>;
  reconcileAll?(): Promise<void>;
}

export interface RagHooksOptions {
  userRepoDir: string;
  ragDir: string;
  /** When set, enables vector store and reconcile (Phase 6). */
  env?: RuntimeEnv;
  packageRoot?: string;
}

let sharedService: RagService | null = null;

function getService(options: RagHooksOptions): RagService | null {
  if (!options.env || !options.packageRoot) {
    return null;
  }
  if (!sharedService) {
    sharedService = createRagService({
      env: options.env,
      packageRoot: options.packageRoot,
    });
  }
  return sharedService;
}

/**
 * RAG hooks for similarity search and indexing (P5-T04 / P6-T01+).
 */
export function createRagHooks(options: RagHooksOptions): RagIndexHooks {
  const service = getService(options);

  return {
    async findSimilarFiles(query: string, limit = 5): Promise<string[]> {
      if (service) {
        return service.findSimilarFiles(query, limit);
      }
      return keywordSimilarIndexedFiles(options.userRepoDir, query, limit);
    },

    async indexFile(relativePath: string): Promise<void> {
      if (service) {
        await service.indexFile(relativePath);
      }
    },

    async reconcileAll(): Promise<void> {
      if (!service) {
        return;
      }
      const stats = await service.reconcileAll();
      logRagReconcileStats(stats);
    },
  };
}

/** Reset shared service (tests). */
export function resetRagHooksForTests(): void {
  sharedService = null;
}
