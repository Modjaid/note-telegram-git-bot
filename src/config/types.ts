/**
 * Host-side instance registry and per-instance settings.
 * Secrets live in ~/.note-agent/instances.json (chmod 600 on write — P1-T01).
 */

/** Schema version for ~/.note-agent/instances.json */
export const INSTANCES_REGISTRY_VERSION = 1 as const;

/** Default git branch when the instance does not override it (Q3). */
export const DEFAULT_GIT_BRANCH = "node_telegram_bot";

/**
 * Cached LLM choice from LLmModels.json (provider + sub-models).
 * One `llmApiKey` on the instance covers both roles.
 * If the catalog omits rag or dialogue id, setup uses the id that exists for both.
 */
export interface InstanceLlmConfig {
  /** Provider `id` from LLmModels.json `providers[].id` */
  providerId: string;
  /** `models.rag.id` (user may override for local providers) */
  ragModelId: string;
  /** `models.dialogue.id` */
  dialogueModelId: string;
  /**
   * OpenAI-compatible base URL for `local: true` providers.
   * Omitted when using cloud defaults only.
   */
  llmBaseUrl?: string;
}

/**
 * One Docker instance = one registry entry + host dirs under
 * ~/.note-agent/instances/<containerName>/.
 */
export interface InstanceRecord {
  /** Docker container name (also host data directory key) */
  containerName: string;
  telegramBotToken: string;
  llm: InstanceLlmConfig;
  /** Single LLM API key for this instance (RAG + dialogue); optional when local / apiKeyRequired: false */
  llmApiKey?: string;
  /** Only this Telegram user id is handled by the gateway */
  allowedTelegramUserId: string;
  gitPat: string;
  gitRepoUrl: string;
  /** Branch for bot commits; created on container start if missing */
  gitBranch: string;
  createdAt: string;
  updatedAt?: string;
}

export interface InstancesRegistry {
  version: typeof INSTANCES_REGISTRY_VERSION;
  instances: InstanceRecord[];
}

/** Non-secret slice passed into the container via env/file (P1-T06). */
export interface InstanceRuntimeConfig {
  containerName: string;
  allowedTelegramUserId: string;
  gitRepoUrl: string;
  gitBranch: string;
  llm: InstanceLlmConfig;
}

export function toRuntimeConfig(record: InstanceRecord): InstanceRuntimeConfig {
  return {
    containerName: record.containerName,
    allowedTelegramUserId: record.allowedTelegramUserId,
    gitRepoUrl: record.gitRepoUrl,
    gitBranch: record.gitBranch,
    llm: record.llm,
  };
}

export function createEmptyRegistry(): InstancesRegistry {
  return { version: INSTANCES_REGISTRY_VERSION, instances: [] };
}
