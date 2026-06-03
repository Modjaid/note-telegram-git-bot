import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

/** Text extensions indexed under UserRepo (P6-T07). */
export const INDEXABLE_TEXT_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".csv",
  ".rst",
]);

/** Known binary extensions — never indexed. */
const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".bmp",
  ".svg",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".7z",
  ".rar",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".mp3",
  ".mp4",
  ".wav",
  ".avi",
  ".mov",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".db",
  ".sqlite",
  ".pyc",
  ".class",
  ".jar",
  ".wasm",
]);

const CONFIG_PREFIX = "note_telegram_bot/config/";

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
}

/** Repo-relative directory paths that must not be walked. */
export function isRagExcludedDirectory(relativeDir: string): boolean {
  const normalized = normalizeRelativePath(relativeDir);
  if (normalized === ".git" || normalized.endsWith("/.git")) {
    return true;
  }
  if (
    normalized === "note_telegram_bot/config" ||
    normalized.startsWith(CONFIG_PREFIX)
  ) {
    return true;
  }
  return false;
}

/**
 * Whether a repo-relative file path should be indexed (P6-T07).
 * All of UserRepo/ except note_telegram_bot/config/, .git/, and binary/non-text.
 */
export function isRagIndexablePath(relativePath: string): boolean {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized || normalized.endsWith("/")) {
    return false;
  }
  if (
    normalized === ".git" ||
    normalized.startsWith(".git/") ||
    normalized.includes("/.git/")
  ) {
    return false;
  }
  if (normalized.startsWith(CONFIG_PREFIX)) {
    return false;
  }

  const baseName = normalized.split("/").pop() ?? normalized;
  if (baseName === ".gitkeep") {
    return false;
  }

  const ext = fileExtension(baseName);
  if (!ext) {
    return false;
  }
  if (BINARY_EXTENSIONS.has(ext)) {
    return false;
  }
  return INDEXABLE_TEXT_EXTENSIONS.has(ext);
}

/** Walk UserRepo and return sorted repo-relative indexable file paths. */
export async function discoverRagIndexablePaths(
  userRepoDir: string,
): Promise<string[]> {
  const paths: string[] = [];
  await walkIndexable(userRepoDir, userRepoDir, paths);
  return paths.sort();
}

async function walkIndexable(
  userRepoDir: string,
  dir: string,
  out: string[],
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".git") {
        continue;
      }
      const relDir = relative(userRepoDir, absolute).replace(/\\/g, "/");
      if (isRagExcludedDirectory(relDir)) {
        continue;
      }
      await walkIndexable(userRepoDir, absolute, out);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const rel = relative(userRepoDir, absolute).replace(/\\/g, "/");
    if (!isRagIndexablePath(rel)) {
      continue;
    }

    try {
      const fileStat = await stat(absolute);
      if (fileStat.isFile()) {
        out.push(rel);
      }
    } catch {
      // skip unreadable
    }
  }
}
