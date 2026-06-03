import type { LlmProviderCatalogEntry } from "../config/llm-catalog.js";
import { resolveLocalBaseUrl } from "../config/llm-catalog-loader.js";
import type { RuntimeEnv } from "../runtime/env.js";

export interface EmbeddingClient {
  readonly modelId: string;
  readonly supportsEmbeddings: boolean;
  embed(texts: string[]): Promise<number[][]>;
}

const OPENAI_COMPAT_BASES: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  mistral: "https://api.mistral.ai/v1",
  together: "https://api.together.xyz/v1",
  fireworks: "https://api.fireworks.ai/inference/v1",
  openrouter: "https://openrouter.ai/api/v1",
  voyage: "https://api.voyageai.com/v1",
  "azure-openai": "https://api.openai.azure.com/openai/deployments",
};

export function createEmbeddingClient(
  env: RuntimeEnv,
  provider: LlmProviderCatalogEntry,
): EmbeddingClient {
  const modelId = env.llm.ragModelId;
  const supportsEmbeddings = provider.models.rag.type === "embedding";

  return {
    modelId,
    supportsEmbeddings,
    async embed(texts: string[]): Promise<number[][]> {
      if (!supportsEmbeddings || texts.length === 0) {
        return texts.map(() => []);
      }
      return embedBatch(env, provider, modelId, texts);
    },
  };
}

async function embedBatch(
  env: RuntimeEnv,
  provider: LlmProviderCatalogEntry,
  modelId: string,
  texts: string[],
): Promise<number[][]> {
  if (provider.id === "google") {
    return embedGoogle(env, modelId, texts);
  }
  if (provider.id === "cohere") {
    return embedCohere(env, modelId, texts);
  }
  if (provider.local && provider.connection?.protocol === "ollama") {
    return embedOllama(env, provider, modelId, texts);
  }

  const baseUrl = resolveOpenAiEmbedBaseUrl(provider, env);
  if (!baseUrl) {
    throw new Error(
      `Provider ${provider.id} has no embedding API base URL configured.`,
    );
  }

  const apiKey = env.llmApiKey;
  if (provider.apiKeyRequired !== false && !apiKey) {
    throw new Error("LLM_API_KEY is required for embedding requests.");
  }

  const response = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: modelId,
      input: texts.length === 1 ? texts[0] : texts,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Embedding request failed (${response.status}): ${detail}`);
  }

  const payload = (await response.json()) as {
    data?: Array<{ embedding?: number[]; index?: number }>;
  };
  const rows = payload.data ?? [];
  if (rows.length !== texts.length) {
    throw new Error(
      `Embedding API returned ${rows.length} vectors for ${texts.length} inputs.`,
    );
  }

  const sorted = [...rows].sort(
    (a, b) => (a.index ?? 0) - (b.index ?? 0),
  );
  return sorted.map((row) => {
    if (!row.embedding?.length) {
      throw new Error("Embedding API returned an empty vector.");
    }
    return row.embedding;
  });
}

async function embedOllama(
  env: RuntimeEnv,
  provider: LlmProviderCatalogEntry,
  modelId: string,
  texts: string[],
): Promise<number[][]> {
  const base =
    env.llm.llmBaseUrl ??
    resolveLocalBaseUrl(provider) ??
    provider.connection?.defaultBaseUrl;
  if (!base) {
    throw new Error("Ollama base URL is not configured.");
  }
  const root = base.replace(/\/+$/, "").replace(/\/v1$/, "");

  const vectors: number[][] = [];
  for (const text of texts) {
    const response = await fetch(`${root}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelId, prompt: text }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Ollama embed failed (${response.status}): ${detail}`);
    }
    const payload = (await response.json()) as { embedding?: number[] };
    if (!payload.embedding?.length) {
      throw new Error("Ollama returned an empty embedding.");
    }
    vectors.push(payload.embedding);
  }
  return vectors;
}

async function embedGoogle(
  env: RuntimeEnv,
  modelId: string,
  texts: string[],
): Promise<number[][]> {
  if (!env.llmApiKey) {
    throw new Error("LLM_API_KEY is required for Google embeddings.");
  }

  const vectors: number[][] = [];
  for (const text of texts) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:embedContent?key=${encodeURIComponent(env.llmApiKey)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: { parts: [{ text }] },
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Google embed failed (${response.status}): ${detail}`);
    }
    const payload = (await response.json()) as {
      embedding?: { values?: number[] };
    };
    const values = payload.embedding?.values;
    if (!values?.length) {
      throw new Error("Google returned an empty embedding.");
    }
    vectors.push(values);
  }
  return vectors;
}

async function embedCohere(
  env: RuntimeEnv,
  modelId: string,
  texts: string[],
): Promise<number[][]> {
  if (!env.llmApiKey) {
    throw new Error("LLM_API_KEY is required for Cohere embeddings.");
  }

  const response = await fetch("https://api.cohere.com/v1/embed", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.llmApiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      texts,
      input_type: "search_document",
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Cohere embed failed (${response.status}): ${detail}`);
  }

  const payload = (await response.json()) as {
    embeddings?: number[][];
  };
  const embeddings = payload.embeddings;
  if (!embeddings || embeddings.length !== texts.length) {
    throw new Error("Cohere returned an unexpected embedding batch.");
  }
  return embeddings;
}

function resolveOpenAiEmbedBaseUrl(
  provider: LlmProviderCatalogEntry,
  env: RuntimeEnv,
): string | undefined {
  if (provider.local) {
    const base =
      env.llm.llmBaseUrl ??
      resolveLocalBaseUrl(provider) ??
      provider.connection?.defaultBaseUrl;
    if (!base) {
      return undefined;
    }
    return base.replace(/\/+$/, "").endsWith("/v1")
      ? base.replace(/\/+$/, "")
      : `${base.replace(/\/+$/, "")}/v1`;
  }
  return OPENAI_COMPAT_BASES[provider.id];
}
