import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ntbIndexedDir } from "../paths/index.js";

/** Keyword overlap search when vector embeddings are unavailable. */
export async function keywordSimilarIndexedFiles(
  userRepoDir: string,
  query: string,
  limit = 5,
): Promise<string[]> {
  const keywords = tokenize(query);
  if (keywords.length === 0) {
    return [];
  }

  const indexedDir = ntbIndexedDir(userRepoDir);
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
