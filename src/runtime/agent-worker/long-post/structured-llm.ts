import type { LlmProviderCatalogEntry } from "../../../config/llm-catalog.js";
import { resolveLocalBaseUrl } from "../../../config/llm-catalog-loader.js";
import type { RuntimeEnv } from "../../env.js";
import {
  longPostOutputSchema,
  type LongPostAgentOutput,
  parseLongPostOutput,
} from "./schema.js";

export interface StructuredLlmCallOptions {
  env: RuntimeEnv;
  provider: LlmProviderCatalogEntry;
  system: string;
  user: string;
}

const OPENAI_COMPAT_BASES: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  mistral: "https://api.mistral.ai/v1",
  groq: "https://api.groq.com/openai/v1",
  deepseek: "https://api.deepseek.com/v1",
  together: "https://api.together.xyz/v1",
  fireworks: "https://api.fireworks.ai/inference/v1",
  xai: "https://api.x.ai/v1",
};

/** Structured JSON chat for non-Google providers (OpenAI-compatible or Anthropic). */
export async function callOpenAiCompatibleStructured(
  options: StructuredLlmCallOptions,
): Promise<LongPostAgentOutput> {
  const { env, provider, system, user } = options;

  if (provider.id === "anthropic") {
    return callAnthropic(env, user, system);
  }

  const baseUrl = resolveOpenAiBaseUrl(provider, env);
  if (!baseUrl) {
    throw new Error(
      `Provider ${provider.id} has no chat API base URL configured.`,
    );
  }

  const apiKey = env.llmApiKey;
  if (provider.apiKeyRequired !== false && !apiKey) {
    throw new Error("LLM_API_KEY is required for long-post processing.");
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: env.llm.dialogueModelId,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `${user}\n\nRespond with JSON only.` },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`LLM request failed (${response.status}): ${detail}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content?.trim()) {
    throw new Error("LLM returned empty content.");
  }

  const parsed = parseLongPostOutput(content);
  longPostOutputSchema.parse(parsed);
  return parsed;
}

async function callAnthropic(
  env: RuntimeEnv,
  user: string,
  system: string,
): Promise<LongPostAgentOutput> {
  if (!env.llmApiKey) {
    throw new Error("LLM_API_KEY is required for Anthropic long-post processing.");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.llmApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: env.llm.dialogueModelId,
      max_tokens: 2048,
      system: `${system}\nRespond with JSON only.`,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Anthropic request failed (${response.status}): ${detail}`);
  }

  const payload = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = payload.content?.find((part) => part.type === "text")?.text;
  if (!text?.trim()) {
    throw new Error("Anthropic returned empty content.");
  }

  return parseLongPostOutput(text);
}

function resolveOpenAiBaseUrl(
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
