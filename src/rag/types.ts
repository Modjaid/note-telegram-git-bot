/** One indexed text segment with its embedding vector. */
export interface RagChunk {
  id: string;
  /** Repo-relative path, e.g. note_telegram_bot/daily/02_Jun_2026.md */
  sourcePath: string;
  /** Zero-based chunk index within the source file. */
  chunkIndex: number;
  text: string;
  vector: number[];
}

/** Per-file mtime registry entry (P6-T01). */
export interface RagFileEntry {
  mtimeMs: number;
  chunkIds: string[];
}

export interface RagRegistry {
  version: 1;
  files: Record<string, RagFileEntry>;
}

export interface RagVectorStore {
  version: 1;
  /** Embedding model id used to build this index (for invalidation hints). */
  embeddingModelId: string;
  chunks: Record<string, RagChunk>;
}

export interface RagReconcileStats {
  indexed: number;
  reindexed: number;
  removed: number;
  skipped: number;
  errors: string[];
}
