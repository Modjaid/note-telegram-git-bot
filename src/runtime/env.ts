import type { InstanceLlmConfig } from "../config/types.js";
import { CONTAINER_RAG, CONTAINER_USER_REPO } from "../paths/index.js";

export interface RuntimeEnv {
  containerName: string;
  allowedTelegramUserId: string;
  gitRepoUrl: string;
  gitBranch: string;
  gitPat: string;
  telegramBotToken: string;
  llm: InstanceLlmConfig;
  llmApiKey?: string;
  userRepoDir: string;
  ragDir: string;
  agentWorkerPort: number;
  gatewayHealthPort: number;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function parsePort(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const port = Number.parseInt(raw, 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port in ${name}: ${raw}`);
  }
  return port;
}

/** Load container configuration from env (set by host CLI on `docker run`). */
export function loadRuntimeEnv(): RuntimeEnv {
  return {
    containerName: requireEnv("NOTE_AGENT_CONTAINER_NAME"),
    allowedTelegramUserId: requireEnv("NOTE_AGENT_ALLOWED_USER_ID"),
    gitRepoUrl: requireEnv("NOTE_AGENT_GIT_REPO_URL"),
    gitBranch: requireEnv("NOTE_AGENT_GIT_BRANCH"),
    gitPat: requireEnv("GIT_PAT"),
    telegramBotToken: requireEnv("TELEGRAM_BOT_TOKEN"),
    llm: {
      providerId: requireEnv("NOTE_AGENT_LLM_PROVIDER_ID"),
      ragModelId: requireEnv("NOTE_AGENT_RAG_MODEL_ID"),
      dialogueModelId: requireEnv("NOTE_AGENT_DIALOGUE_MODEL_ID"),
      llmBaseUrl: optionalEnv("NOTE_AGENT_LLM_BASE_URL"),
    },
    llmApiKey: optionalEnv("LLM_API_KEY"),
    userRepoDir: CONTAINER_USER_REPO,
    ragDir: CONTAINER_RAG,
    agentWorkerPort: parsePort("NOTE_AGENT_AGENT_WORKER_PORT", 3710),
    gatewayHealthPort: parsePort("NOTE_AGENT_GATEWAY_HEALTH_PORT", 3711),
  };
}
