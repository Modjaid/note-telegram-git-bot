import type { LlmProviderCatalogEntry } from "./llm-catalog.js";
import type { InstanceLlmConfig } from "./types.js";

export class LlmModelResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmModelResolutionError";
  }
}

/**
 * One API key per instance; RAG and dialogue use catalog sub-models when both exist.
 * If only one sub-model id is set, the same id is used for the missing role.
 */
export function resolveProviderModelIds(provider: LlmProviderCatalogEntry): {
  ragModelId: string;
  dialogueModelId: string;
  usedFallback: boolean;
} {
  const rag = provider.models.rag.id;
  const dialogue = provider.models.dialogue.id;

  if (typeof rag === "string" && typeof dialogue === "string") {
    return { ragModelId: rag, dialogueModelId: dialogue, usedFallback: false };
  }
  if (typeof rag === "string" && dialogue == null) {
    return { ragModelId: rag, dialogueModelId: rag, usedFallback: true };
  }
  if (rag == null && typeof dialogue === "string") {
    return { ragModelId: dialogue, dialogueModelId: dialogue, usedFallback: true };
  }
  throw new LlmModelResolutionError(
    `Provider "${provider.id}" must define at least one of models.rag.id or models.dialogue.id`,
  );
}

/** Apply fallback when persisted config has an empty slot (legacy/manual edits). */
export function normalizeInstanceLlmConfig(
  llm: InstanceLlmConfig,
): InstanceLlmConfig {
  const rag = llm.ragModelId.trim();
  const dialogue = llm.dialogueModelId.trim();
  if (rag && dialogue) {
    return { ...llm, ragModelId: rag, dialogueModelId: dialogue };
  }
  if (rag && !dialogue) {
    return { ...llm, ragModelId: rag, dialogueModelId: rag };
  }
  if (!rag && dialogue) {
    return { ...llm, ragModelId: dialogue, dialogueModelId: dialogue };
  }
  return llm;
}

export function providerHasResolvableModels(
  provider: LlmProviderCatalogEntry,
): boolean {
  const rag = provider.models.rag.id;
  const dialogue = provider.models.dialogue.id;
  return typeof rag === "string" || typeof dialogue === "string";
}
