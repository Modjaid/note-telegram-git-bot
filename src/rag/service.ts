import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { findProvider } from "../config/llm-catalog.js";
import { loadLlmModelsCatalog } from "../config/llm-catalog-loader.js";
import type { RuntimeEnv } from "../runtime/env.js";
import { keywordSimilarIndexedFiles } from "./keyword-search.js";
import { buildRagChunks } from "./chunk-metadata.js";
import { createEmbeddingClient } from "./embeddings.js";
import {
  discoverRagIndexablePaths,
  isRagIndexablePath,
} from "./indexable-paths.js";
import { RagPersistence, chunkIdFor, cosineSimilarity } from "./store.js";
import type {
  RagChunk,
  RagReconcileStats,
  RagRegistry,
  RagVectorStore,
} from "./types.js";

export interface RagServiceOptions {
  env: RuntimeEnv;
  packageRoot: string;
}

export { isRagIndexablePath } from "./indexable-paths.js";

/**
 * RAG index: mtime registry + vector store under host rag/ (P6-T01–T03).
 */
export class RagService {
  readonly #env: RuntimeEnv;
  readonly #userRepoDir: string;
  readonly #ragDir: string;
  readonly #packageRoot: string;
  #persistence: RagPersistence | null = null;
  #embeddingsWarned = false;

  constructor(options: RagServiceOptions) {
    this.#env = options.env;
    this.#userRepoDir = options.env.userRepoDir;
    this.#ragDir = options.env.ragDir;
    this.#packageRoot = options.packageRoot;
  }

  /** Index or re-index one repo-relative path after a local write (P6-T05). */
  async indexFile(relativePath: string): Promise<void> {
    await this.reconcilePaths([relativePath.replace(/\\/g, "/")]);
  }

  /** Full UserRepo scan vs registry (P6-T02, P6-T04, P6-T06). */
  async reconcileAll(): Promise<RagReconcileStats> {
    const paths = await this.#discoverIndexablePaths();
    const stats = await this.reconcilePaths(paths);
    const deletions = await this.reconcileDeletions();
    return mergeStats(stats, deletions);
  }

  /** Reconcile specific paths (same mtime algorithm as full scan). */
  async reconcilePaths(relativePaths: string[]): Promise<RagReconcileStats> {
    const stats: RagReconcileStats = {
      indexed: 0,
      reindexed: 0,
      removed: 0,
      skipped: 0,
      errors: [],
    };

    const client = await this.#getEmbeddingClient();
    if (!client.supportsEmbeddings) {
      if (!this.#embeddingsWarned) {
        console.warn(
          `RAG: provider ${this.#env.llm.providerId} rag model is not type "embedding"; vector indexing skipped.`,
        );
        this.#embeddingsWarned = true;
      }
      stats.skipped += relativePaths.length;
      return stats;
    }

    const persistence = await this.#getPersistence(client.modelId);
    const registry = await persistence.loadRegistry();
    const store = await persistence.loadStore();
    const normalized = new Set(
      relativePaths.map((p) => p.replace(/\\/g, "/")),
    );

    for (const relPath of normalized) {
      if (!isRagIndexablePath(relPath)) {
        stats.skipped += 1;
        continue;
      }

      const absolute = join(this.#userRepoDir, relPath);
      let fileStat;
      try {
        fileStat = await stat(absolute);
      } catch {
        await this.#removeFile(relPath, registry, store, stats);
        continue;
      }

      if (!fileStat.isFile()) {
        stats.skipped += 1;
        continue;
      }

      const mtimeMs = fileStat.mtimeMs;
      const existing = registry.files[relPath];
      if (existing && existing.mtimeMs === mtimeMs) {
        stats.skipped += 1;
        continue;
      }

      try {
        const content = await readFile(absolute, "utf8");
        const built = buildRagChunks(relPath, content);
        if (built.length === 0) {
          await this.#removeFile(relPath, registry, store, stats);
          continue;
        }

        if (existing) {
          this.#dropChunks(existing.chunkIds, registry, store);
          stats.reindexed += 1;
        } else {
          stats.indexed += 1;
        }

        const texts = built.map((c) => c.text);
        const vectors = await client.embed(texts);
        const chunkIds: string[] = [];
        for (let i = 0; i < built.length; i++) {
          const id = chunkIdFor(relPath, i);
          const chunk: RagChunk = {
            id,
            sourcePath: relPath,
            chunkIndex: i,
            text: built[i].text,
            vector: vectors[i] ?? [],
            metadata: built[i].metadata,
          };
          store.chunks[id] = chunk;
          chunkIds.push(id);
        }

        registry.files[relPath] = { mtimeMs, chunkIds };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        stats.errors.push(`${relPath}: ${msg}`);
      }
    }

    await persistence.saveRegistry(registry);
    await persistence.saveStore(store);
    return stats;
  }

  /** Remove registry entries for files deleted from disk. */
  async reconcileDeletions(): Promise<RagReconcileStats> {
    const stats: RagReconcileStats = {
      indexed: 0,
      reindexed: 0,
      removed: 0,
      skipped: 0,
      errors: [],
    };

    const client = await this.#getEmbeddingClient();
    const persistence = await this.#getPersistence(client.modelId);
    const registry = await persistence.loadRegistry();
    const store = await persistence.loadStore();
    const onDisk = new Set(await this.#discoverIndexablePaths());

    for (const relPath of Object.keys(registry.files)) {
      if (!onDisk.has(relPath)) {
        await this.#removeFile(relPath, registry, store, stats);
      }
    }

    await persistence.saveRegistry(registry);
    await persistence.saveStore(store);
    return stats;
  }

  /**
   * Vector similarity search over indexed/ chunks (P5-T04).
   * Falls back to keyword overlap when embeddings are unavailable.
   */
  async findSimilarFiles(query: string, limit = 5): Promise<string[]> {
    const client = await this.#getEmbeddingClient();
    if (!client.supportsEmbeddings) {
      return this.#keywordSimilar(query, limit);
    }

    let queryVector: number[];
    try {
      [queryVector] = await client.embed([query]);
    } catch {
      return this.#keywordSimilar(query, limit);
    }

    if (!queryVector?.length) {
      return this.#keywordSimilar(query, limit);
    }

    const persistence = await this.#getPersistence(client.modelId);
    const store = await persistence.loadStore();
    const scored = new Map<string, number>();

    for (const chunk of Object.values(store.chunks)) {
      if (!chunk.sourcePath.includes("/indexed/")) {
        continue;
      }
      const chunkType = chunk.metadata?.chunkType;
      if (
        chunkType &&
        chunkType !== "indexed_summary" &&
        chunkType !== "indexed_body"
      ) {
        continue;
      }
      const score = cosineSimilarity(queryVector, chunk.vector);
      if (score <= 0) {
        continue;
      }
      const base = chunk.sourcePath.split("/").pop()?.replace(/\.md$/i, "") ?? "";
      const key = base.toUpperCase();
      const prev = scored.get(key) ?? 0;
      if (score > prev) {
        scored.set(key, score);
      }
    }

    return [...scored.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([name]) => name);
  }

  async #removeFile(
    relPath: string,
    registry: RagRegistry,
    store: RagVectorStore,
    stats: RagReconcileStats,
  ): Promise<void> {
    const entry = registry.files[relPath];
    if (!entry) {
      return;
    }
    this.#dropChunks(entry.chunkIds, registry, store);
    delete registry.files[relPath];
    stats.removed += 1;
  }

  #dropChunks(
    chunkIds: string[],
    registry: RagRegistry,
    store: RagVectorStore,
  ): void {
    for (const id of chunkIds) {
      delete store.chunks[id];
    }
    void registry;
  }

  async #discoverIndexablePaths(): Promise<string[]> {
    return discoverRagIndexablePaths(this.#userRepoDir);
  }

  async #keywordSimilar(query: string, limit: number): Promise<string[]> {
    return keywordSimilarIndexedFiles(this.#userRepoDir, query, limit);
  }

  async #getEmbeddingClient() {
    const catalog = await loadLlmModelsCatalog(this.#packageRoot);
    const provider = findProvider(catalog, this.#env.llm.providerId);
    if (!provider) {
      throw new Error(`Unknown LLM provider: ${this.#env.llm.providerId}`);
    }
    return createEmbeddingClient(this.#env, provider);
  }

  async #getPersistence(modelId: string): Promise<RagPersistence> {
    this.#persistence ??= new RagPersistence(this.#ragDir, modelId);
    return this.#persistence;
  }
}

function mergeStats(
  a: RagReconcileStats,
  b: RagReconcileStats,
): RagReconcileStats {
  return {
    indexed: a.indexed + b.indexed,
    reindexed: a.reindexed + b.reindexed,
    removed: a.removed + b.removed,
    skipped: a.skipped + b.skipped,
    errors: [...a.errors, ...b.errors],
  };
}

export function createRagService(options: RagServiceOptions): RagService {
  return new RagService(options);
}
