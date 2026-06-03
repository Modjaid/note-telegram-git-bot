import { readFile } from "node:fs/promises";
import type { LlmModelsCatalog, LlmProviderCatalogEntry } from "./llm-catalog.js";
import { llmModelsCatalogPath } from "../paths/index.js";
import { providerHasResolvableModels } from "./resolve-model-ids.js";

export class LlmCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmCatalogError";
  }
}

function isModelSlot(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const id = (value as Record<string, unknown>).id;
  return typeof id === "string" || id === null;
}

function isProviderEntry(value: unknown): value is LlmProviderCatalogEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const p = value as LlmProviderCatalogEntry;
  if (typeof p.id !== "string" || typeof p.name !== "string") {
    return false;
  }
  const models = p.models;
  if (!models || !isModelSlot(models.rag) || !isModelSlot(models.dialogue)) {
    return false;
  }
  return providerHasResolvableModels(p);
}

function describeInvalidProvider(entry: unknown): string {
  if (typeof entry !== "object" || entry === null) {
    return "entry is not an object";
  }
  const p = entry as Record<string, unknown>;
  const providerId =
    typeof p.id === "string" ? p.id : "(missing provider id)";
  const models = p.models as Record<string, unknown> | undefined;
  const rag = models?.rag as Record<string, unknown> | undefined;
  const dialogue = models?.dialogue as Record<string, unknown> | undefined;
  const parts: string[] = [];
  if (typeof p.name !== "string") {
    parts.push("name");
  }
  if (!isModelSlot(rag) || !isModelSlot(dialogue)) {
    parts.push("models.rag / models.dialogue slots");
  } else if (
    typeof entry === "object" &&
    entry !== null &&
    !providerHasResolvableModels(entry as LlmProviderCatalogEntry)
  ) {
    parts.push("at least one of models.rag.id or models.dialogue.id");
  }
  const detail = parts.length > 0 ? parts.join(", ") : "invalid structure";
  return `provider "${providerId}": ${detail}`;
}

function parseCatalog(raw: string, sourceLabel: string): LlmModelsCatalog {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new LlmCatalogError(`Invalid JSON in ${sourceLabel}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new LlmCatalogError(`Catalog root must be an object (${sourceLabel})`);
  }
  const root = parsed as Record<string, unknown>;
  if (!Array.isArray(root.providers)) {
    throw new LlmCatalogError(`Catalog must include providers[] (${sourceLabel})`);
  }
  for (const entry of root.providers) {
    if (!isProviderEntry(entry)) {
      throw new LlmCatalogError(
        `Invalid provider entry in ${sourceLabel}: ${describeInvalidProvider(entry)}`,
      );
    }
  }
  return parsed as LlmModelsCatalog;
}

/** Load LLmModels.json from the package root (P1-T02 / P6-T01). */
export async function loadLlmModelsCatalog(
  packageRoot: string,
): Promise<LlmModelsCatalog> {
  const path = llmModelsCatalogPath(packageRoot);
  const raw = await readFile(path, "utf8");
  return parseCatalog(raw, path);
}

/** Whether the CLI should prompt for an API key. */
export function isApiKeyRequired(provider: LlmProviderCatalogEntry): boolean {
  if (provider.apiKeyRequired === false) {
    return false;
  }
  if (provider.local === true) {
    return false;
  }
  return provider.apiKeyRequired ?? true;
}

/** Resolve base URL for a local provider (env override, then catalog default). */
export function resolveLocalBaseUrl(
  provider: LlmProviderCatalogEntry,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (!provider.local || !provider.connection) {
    return undefined;
  }
  const envKey = provider.connection.baseUrlEnv;
  if (envKey && env[envKey]?.trim()) {
    return env[envKey].trim();
  }
  return provider.connection.defaultBaseUrl;
}
