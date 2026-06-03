import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ntbIndexedDir } from "../paths/index.js";

export interface RagIndexHooks {
  findSimilarFiles(query: string, limit?: number): Promise<string[]>;
  indexFile(relativePath: string): Promise<void>;
}

export interface RagHooksOptions {
  userRepoDir: string;
  ragDir: string;
}

/**
 * Phase 5 stub / Phase 6 extension point for vector similarity and indexing.
 * P5-T04 / P5-T07 call these hooks; full reconcile arrives in Phase 6.
 */
export function createRagHooks(options: RagHooksOptions): RagIndexHooks {
  const indexedDir = ntbIndexedDir(options.userRepoDir);

  return {
    async findSimilarFiles(query: string, limit = 5): Promise<string[]> {
      void options.ragDir;
      const keywords = tokenize(query);
      if (keywords.length === 0) {
        return [];
      }

      let entries: string[];
      try {
        entries = await readdir(indexedDir);
      } catch {
        return [];
      }

      const scored: Array<{ name: string; score: number }> = [];
      for (const entry of entries) {
        if (!entry.endsWith(".md")) {
          continue;
        }
        try {
          const body = await readFile(join(indexedDir, entry), "utf8");
          const score = overlapScore(keywords, tokenize(body));
          if (score > 0) {
            scored.push({ name: entry, score });
          }
        } catch {
          // skip unreadable files
        }
      }

      return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((item) => item.name.replace(/\.md$/i, "").toUpperCase());
    },

    async indexFile(relativePath: string): Promise<void> {
      // Phase 6: embed and persist vectors under ragDir with mtime registry.
      void relativePath;
      void options.ragDir;
    },
  };
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length >= 4);
}

function overlapScore(queryTokens: string[], docTokens: string[]): number {
  const docSet = new Set(docTokens);
  let score = 0;
  for (const token of queryTokens) {
    if (docSet.has(token)) {
      score += 1;
    }
  }
  return score;
}
