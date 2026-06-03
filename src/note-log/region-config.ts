import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ntbConfigDir } from "../paths/index.js";
import { isValidTimezone, parseTimezoneInput } from "./timezone.js";

export interface RegionConfig {
  timezone: string;
}

export function regionConfigPath(userRepoRoot: string): string {
  return join(ntbConfigDir(userRepoRoot), "region.json");
}

export async function loadRegionConfig(
  userRepoRoot: string,
): Promise<RegionConfig | null> {
  try {
    const raw = await readFile(regionConfigPath(userRepoRoot), "utf8");
    const parsed = JSON.parse(raw) as { timezone?: unknown };
    if (
      typeof parsed.timezone === "string" &&
      isValidTimezone(parsed.timezone)
    ) {
      return { timezone: parsed.timezone.trim() };
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveRegionConfig(
  userRepoRoot: string,
  timezone: string,
): Promise<void> {
  const trimmed = timezone.trim();
  if (!isValidTimezone(trimmed)) {
    throw new Error(`Invalid timezone: ${timezone}`);
  }
  const configDir = ntbConfigDir(userRepoRoot);
  await mkdir(configDir, { recursive: true });
  const body = `${JSON.stringify({ timezone: trimmed }, null, 2)}\n`;
  await writeFile(regionConfigPath(userRepoRoot), body, "utf8");
}

export { parseTimezoneInput };
