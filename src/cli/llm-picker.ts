import type { InstanceLlmConfig } from "../config/types.js";
import type { LlmModelsCatalog, LlmProviderCatalogEntry } from "../config/llm-catalog.js";
import {
  isApiKeyRequired,
  resolveLocalBaseUrl,
} from "../config/llm-catalog-loader.js";
import { resolveProviderModelIds } from "../config/resolve-model-ids.js";
import type { PromptSession } from "./prompt.js";
import { promptOptional, promptWithDefault } from "./prompt.js";

export interface LlmPickerResult {
  llm: InstanceLlmConfig;
  /** One LLM API key per instance (same vendor for RAG + dialogue). */
  llmApiKey?: string;
}

export async function pickLlmConfiguration(
  session: PromptSession,
  catalog: LlmModelsCatalog,
): Promise<LlmPickerResult> {
  const labels = catalog.providers.map((p) => {
    const resolved = resolveProviderModelIds(p);
    const suffix = resolved.usedFallback ? " [single model → both roles]" : "";
    return `${p.name} (${p.id})${p.local ? " [local]" : ""} — RAG: ${resolved.ragModelId}, dialog: ${resolved.dialogueModelId}${suffix}`;
  });
  const index = await session.chooseIndex("Choose LLM provider:", labels);
  const provider = catalog.providers[index]!;
  return configureProvider(session, provider);
}

async function configureProvider(
  session: PromptSession,
  provider: LlmProviderCatalogEntry,
): Promise<LlmPickerResult> {
  console.log(`\nProvider: ${provider.name}`);
  const resolved = resolveProviderModelIds(provider);
  if (resolved.usedFallback) {
    console.log(
      "Only one sub-model in catalog — the same model id will be used for RAG and dialogue (one API key).",
    );
  }
  if (provider.models.rag.notes) {
    console.log(`  RAG notes: ${provider.models.rag.notes}`);
  }
  if (provider.models.dialogue.notes) {
    console.log(`  Dialogue notes: ${provider.models.dialogue.notes}`);
  }

  console.log("\nDefault models — you can leave prompts empty (press Enter):");
  console.log(`  RAG: ${resolved.ragModelId}`);
  console.log(`  Dialogue: ${resolved.dialogueModelId}`);
  console.log("  Type a different model id only if you want to override.\n");

  const ragModelId = await promptWithDefault(
    session,
    "RAG / embedding model id",
    resolved.ragModelId,
  );
  const dialogueModelId = await promptWithDefault(
    session,
    "Dialogue model id",
    resolved.dialogueModelId,
  );

  let llmBaseUrl: string | undefined;
  if (provider.local) {
    const envDefault = resolveLocalBaseUrl(provider) ?? "";
    console.log(
      "Local provider: use model ids that exist on your server (e.g. ollama list).",
    );
    if (provider.connection?.baseUrlEnv) {
      console.log(
        `  Env override: ${provider.connection.baseUrlEnv} (if set on host/container)`,
      );
    }
    console.log("\nDefault base URL — press Enter to accept:\n");
    llmBaseUrl = await promptWithDefault(
      session,
      "Base URL (host or host.docker.internal)",
      envDefault,
    );
  }

  let llmApiKey: string | undefined;
  console.log("One LLM API key per instance (covers RAG and dialogue).");
  if (isApiKeyRequired(provider)) {
    llmApiKey = await promptOptional(
      session,
      "LLM API key",
      "required for this provider",
    );
    if (!llmApiKey) {
      console.log("Warning: no API key entered; container may fail until set.");
    }
  } else {
    llmApiKey = await promptOptional(session, "LLM API key", "optional");
  }

  const llm: InstanceLlmConfig = {
    providerId: provider.id,
    ragModelId,
    dialogueModelId,
    ...(llmBaseUrl ? { llmBaseUrl } : {}),
  };

  console.log("\nCached for this instance (one key, two model ids):");
  console.log(`  RAG: ${llm.ragModelId}`);
  console.log(`  Dialogue: ${llm.dialogueModelId}`);
  if (llm.llmBaseUrl) {
    console.log(`  Base URL: ${llm.llmBaseUrl}`);
  }

  return { llm, llmApiKey };
}
