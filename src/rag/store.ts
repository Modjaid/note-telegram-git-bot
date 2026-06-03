import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RagRegistry, RagVectorStore } from "./types.js";

const REGISTRY_FILE = "registry.json";
const STORE_FILE = "store.json";

function emptyRegistry(): RagRegistry {
  return { version: 1, files: {} };
}

function emptyStore(embeddingModelId: string): RagVectorStore {
  return { version: 1, embeddingModelId, chunks: {} };
}

export class RagPersistence {
  readonly #ragDir: string;
  readonly #embeddingModelId: string;

  constructor(ragDir: string, embeddingModelId: string) {
    this.#ragDir = ragDir;
    this.#embeddingModelId = embeddingModelId;
  }

  async loadRegistry(): Promise<RagRegistry> {
    return this.#loadJson(REGISTRY_FILE, emptyRegistry());
  }

  async loadStore(): Promise<RagVectorStore> {
    const fallback = emptyStore(this.#embeddingModelId);
    const store = await this.#loadJson(STORE_FILE, fallback);
    if (!store.embeddingModelId) {
      store.embeddingModelId = this.#embeddingModelId;
    }
    return store;
  }

  async saveRegistry(registry: RagRegistry): Promise<void> {
    await this.#saveJson(REGISTRY_FILE, registry);
  }

  async saveStore(store: RagVectorStore): Promise<void> {
    await this.#saveJson(STORE_FILE, store);
  }

  async #loadJson<T>(fileName: string, fallback: T): Promise<T> {
    const path = join(this.#ragDir, fileName);
    try {
      const raw = await readFile(path, "utf8");
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  async #saveJson(fileName: string, value: unknown): Promise<void> {
    await mkdir(this.#ragDir, { recursive: true });
    const path = join(this.#ragDir, fileName);
    const tmp = `${path}.tmp`;
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tmp, path);
  }
}

/** Cosine similarity between two equal-length vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function chunkIdFor(sourcePath: string, chunkIndex: number): string {
  return `${sourcePath}#${chunkIndex}`;
}

export function indexedBaseName(sourcePath: string): string {
  const fileName = sourcePath.split("/").pop() ?? sourcePath;
  return fileName.replace(/\.md$/i, "").toUpperCase();
}
