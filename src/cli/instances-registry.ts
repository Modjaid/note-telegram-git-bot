import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import {
  createEmptyRegistry,
  INSTANCES_REGISTRY_VERSION,
  type InstanceRecord,
  type InstancesRegistry,
} from "../config/types.js";
import { INSTANCES_REGISTRY_PATH, NOTE_AGENT_HOME_DIR } from "../paths/index.js";

const REGISTRY_MODE = 0o600;

export class InstancesRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstancesRegistryError";
  }
}

function parseRegistry(raw: string): InstancesRegistry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InstancesRegistryError(
      `Invalid JSON in ${INSTANCES_REGISTRY_PATH}`,
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("version" in parsed) ||
    !("instances" in parsed)
  ) {
    throw new InstancesRegistryError(
      "Registry must contain version and instances array",
    );
  }
  const reg = parsed as InstancesRegistry;
  if (reg.version !== INSTANCES_REGISTRY_VERSION) {
    throw new InstancesRegistryError(
      `Unsupported registry version ${String(reg.version)}; expected ${INSTANCES_REGISTRY_VERSION}`,
    );
  }
  if (!Array.isArray(reg.instances)) {
    throw new InstancesRegistryError("instances must be an array");
  }
  return reg;
}

/** Load registry or return an empty one when the file does not exist yet. */
export async function loadInstancesRegistry(): Promise<InstancesRegistry> {
  try {
    const raw = await readFile(INSTANCES_REGISTRY_PATH, "utf8");
    return parseRegistry(raw);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return createEmptyRegistry();
    }
    throw error;
  }
}

/** Persist registry and enforce chmod 600 on the file (and ensure parent dir exists). */
export async function saveInstancesRegistry(
  registry: InstancesRegistry,
): Promise<void> {
  await mkdir(NOTE_AGENT_HOME_DIR, { recursive: true });
  const payload = `${JSON.stringify(registry, null, 2)}\n`;
  const path = INSTANCES_REGISTRY_PATH;
  await writeFile(path, payload, { encoding: "utf8", mode: REGISTRY_MODE });
  await chmod(path, REGISTRY_MODE);
}

export function findInstance(
  registry: InstancesRegistry,
  containerName: string,
): InstanceRecord | undefined {
  return registry.instances.find((i) => i.containerName === containerName);
}

export function upsertInstance(
  registry: InstancesRegistry,
  record: InstanceRecord,
): InstancesRegistry {
  const now = new Date().toISOString();
  const next = registry.instances.filter(
    (i) => i.containerName !== record.containerName,
  );
  const existing = findInstance(registry, record.containerName);
  next.push({
    ...record,
    createdAt: existing?.createdAt ?? record.createdAt ?? now,
    updatedAt: now,
  });
  return { version: INSTANCES_REGISTRY_VERSION, instances: next };
}

export function removeInstance(
  registry: InstancesRegistry,
  containerName: string,
): InstancesRegistry {
  return {
    version: INSTANCES_REGISTRY_VERSION,
    instances: registry.instances.filter(
      (i) => i.containerName !== containerName,
    ),
  };
}

/** Ensure ~/.note-agent exists (used before first save). */
export async function ensureNoteAgentHome(): Promise<void> {
  await mkdir(NOTE_AGENT_HOME_DIR, { recursive: true });
}

export async function registryFileExists(): Promise<boolean> {
  try {
    await readFile(INSTANCES_REGISTRY_PATH, "utf8");
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}
