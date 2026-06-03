import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Gemini,
  InMemoryRunner,
  LlmAgent,
  isFinalResponse,
  stringifyContent,
} from "@google/adk";
import type { RuntimeEnv } from "../../env.js";
import { findProvider } from "../../../config/llm-catalog.js";
import {
  LONG_POST_SYSTEM_INSTRUCTION,
  buildLongPostUserPrompt,
  longPostOutputSchema,
  parseLongPostOutput,
  type LongPostAgentOutput,
} from "./schema.js";
import { callOpenAiCompatibleStructured } from "./structured-llm.js";

const packageRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

function loadCatalogSync() {
  const raw = readFileSync(join(packageRoot, "LLmModels.json"), "utf8");
  return JSON.parse(raw) as import("../../../config/llm-catalog.js").LlmModelsCatalog;
}

/** Run long-post metadata extraction via ADK (Google) or structured chat (other providers). */
export async function analyzeLongPostText(
  env: RuntimeEnv,
  text: string,
): Promise<LongPostAgentOutput> {
  const catalog = loadCatalogSync();
  const provider = findProvider(catalog, env.llm.providerId);
  if (!provider) {
    throw new Error(`Unknown LLM provider: ${env.llm.providerId}`);
  }

  if (env.llm.providerId === "google") {
    return analyzeWithAdk(env, text);
  }

  return callOpenAiCompatibleStructured({
    env,
    provider,
    system: LONG_POST_SYSTEM_INSTRUCTION,
    user: buildLongPostUserPrompt(text),
  });
}

async function analyzeWithAdk(
  env: RuntimeEnv,
  text: string,
): Promise<LongPostAgentOutput> {
  if (!env.llmApiKey) {
    throw new Error("LLM_API_KEY is required for long-post processing.");
  }

  const model = new Gemini({
    model: env.llm.dialogueModelId,
    apiKey: env.llmApiKey,
  });

  const agent = new LlmAgent({
    model,
    name: "long_post_processor",
    description: "Summarizes long Telegram notes for indexed storage.",
    instruction: LONG_POST_SYSTEM_INSTRUCTION,
    outputSchema: longPostOutputSchema,
    includeContents: "none",
  });

  const runner = new InMemoryRunner({
    agent,
    appName: "note-agent-long-post",
  });

  let responseText = "";
  for await (const event of runner.runEphemeral({
    userId: "note-agent",
    newMessage: {
      role: "user",
      parts: [{ text: buildLongPostUserPrompt(text) }],
    },
  })) {
    if (isFinalResponse(event) && event.content) {
      responseText = stringifyContent(event);
    }
  }

  if (!responseText.trim()) {
    throw new Error("Long-post agent returned an empty response.");
  }

  return parseLongPostOutput(responseText);
}
