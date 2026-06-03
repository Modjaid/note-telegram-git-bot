/**
 * Types for LLmModels.json (loaded at CLI setup — P1-T02).
 * Runtime resolves embeddings and dialogue models from the selected provider entry.
 */

export type LlmModelKind = "embedding" | "chat";

export interface LlmModelSlot {
  /** Null when this role is omitted; the other role's id is reused (one key per instance). */
  id: string | null;
  type: LlmModelKind | "none";
  notes?: string;
}

export interface LlmProviderConnection {
  defaultBaseUrl: string;
  baseUrlEnv?: string;
  protocol?: "ollama" | "openai_compatible";
}

export interface LlmProviderCatalogEntry {
  id: string;
  name: string;
  website?: string;
  apiKeysUrl?: string;
  /** User-hosted provider (Ollama, LM Studio, …) */
  local?: boolean;
  connection?: LlmProviderConnection;
  apiKeyRequired?: boolean;
  models: {
    rag: LlmModelSlot;
    dialogue: LlmModelSlot;
  };
}

export interface LlmModelsCatalog {
  version: number;
  description?: string;
  usage?: Record<string, string>;
  providerFields?: Record<string, string>;
  providers: LlmProviderCatalogEntry[];
}

export function findProvider(
  catalog: LlmModelsCatalog,
  providerId: string,
): LlmProviderCatalogEntry | undefined {
  return catalog.providers.find((p) => p.id === providerId);
}
