export {
  createEmptyRegistry,
  DEFAULT_GIT_BRANCH,
  INSTANCES_REGISTRY_VERSION,
  toRuntimeConfig,
  type InstanceLlmConfig,
  type InstanceRecord,
  type InstanceRuntimeConfig,
  type InstancesRegistry,
} from "./types.js";

export {
  isApiKeyRequired,
  loadLlmModelsCatalog,
  resolveLocalBaseUrl,
  LlmCatalogError,
} from "./llm-catalog-loader.js";

export {
  normalizeInstanceLlmConfig,
  providerHasResolvableModels,
  resolveProviderModelIds,
  LlmModelResolutionError,
} from "./resolve-model-ids.js";

export {
  findProvider,
  type LlmModelKind,
  type LlmModelSlot,
  type LlmModelsCatalog,
  type LlmProviderCatalogEntry,
  type LlmProviderConnection,
} from "./llm-catalog.js";
