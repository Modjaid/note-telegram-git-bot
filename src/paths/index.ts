import { homedir } from "node:os";
import { join } from "node:path";

/** Host config root: ~/.note-agent */
export const NOTE_AGENT_HOME_DIR = join(homedir(), ".note-agent");

/** Registry of all instances (secrets, chmod 600 — P1-T01) */
export const INSTANCES_REGISTRY_PATH = join(
  NOTE_AGENT_HOME_DIR,
  "instances.json",
);

/** Host data root for one instance */
export function instanceDataDir(containerName: string): string {
  return join(NOTE_AGENT_HOME_DIR, "instances", containerName);
}

/** Git working copy bind-mounted to /app/UserRepo */
export function instanceUserRepoDir(containerName: string): string {
  return join(instanceDataDir(containerName), "UserRepo");
}

/** Vector index + mtime registry bind-mounted to /app/rag */
export function instanceRagDir(containerName: string): string {
  return join(instanceDataDir(containerName), "rag");
}

/** Paths inside the Linux container (bind mounts) */
export const CONTAINER_USER_REPO = "/app/UserRepo";
export const CONTAINER_RAG = "/app/rag";

/** Relative path under UserRepo for all bot data */
export const NTB_SEGMENT = "note_telegram_bot";

export function noteTelegramBotRoot(userRepoRoot: string): string {
  return join(userRepoRoot, NTB_SEGMENT);
}

export function ntbDailyDir(userRepoRoot: string): string {
  return join(noteTelegramBotRoot(userRepoRoot), "daily");
}

export function ntbIndexedDir(userRepoRoot: string): string {
  return join(noteTelegramBotRoot(userRepoRoot), "indexed");
}

export function ntbConfigDir(userRepoRoot: string): string {
  return join(noteTelegramBotRoot(userRepoRoot), "config");
}

export function ntbCommandsDir(userRepoRoot: string): string {
  return join(ntbConfigDir(userRepoRoot), "commands");
}

/**
 * Daily note filename: DD_MMM_YYYY.md (e.g. 02_Jun_2026.md).
 * @param day - calendar components in the user's logical day
 */
export function dailyNoteFileName(day: {
  dd: number;
  mmm: string;
  yyyy: number;
}): string {
  const dd = String(day.dd).padStart(2, "0");
  return `${dd}_${day.mmm}_${day.yyyy}.md`;
}

/**
 * Indexed command output pattern: <topic>_DD_MMM_YYYY.md under indexed/.
 */
export function indexedOutputFileName(
  topicSlug: string,
  day: { dd: number; mmm: string; yyyy: number },
): string {
  const dd = String(day.dd).padStart(2, "0");
  return `${topicSlug}_${dd}_${day.mmm}_${day.yyyy}.md`;
}

/** Repo-root path to LLmModels.json (shipped with the package). */
export function llmModelsCatalogPath(packageRoot: string): string {
  return join(packageRoot, "LLmModels.json");
}
