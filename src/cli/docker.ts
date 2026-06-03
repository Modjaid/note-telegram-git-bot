import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import type { InstanceRecord } from "../config/types.js";
import {
  containerLogsLookLikeOldRuntime,
  printRecentContainerLogs,
  waitForContainerHealthy,
} from "./container-health.js";
import {
  CONTAINER_RAG,
  CONTAINER_USER_REPO,
  instanceRagDir,
  instanceUserRepoDir,
} from "../paths/index.js";

export const RUNTIME_IMAGE = "note-agent-runtime:latest";

export type ContainerRunState = "running" | "stopped" | "missing";

export class DockerCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DockerCliError";
  }
}

export function runDocker(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    // Do not use shell on Windows: cmd.exe strips/breaks Docker Go templates ({{...}}).
    const child = spawn("docker", args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      reject(
        new DockerCliError(
          `Failed to run docker: ${err.message}. Is Docker installed and running?`,
        ),
      );
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(
          new DockerCliError(
            stderr.trim() || stdout.trim() || `docker exited with code ${code}`,
          ),
        );
      }
    });
  });
}

export async function isDockerAvailable(): Promise<boolean> {
  try {
    await runDocker(["version", "--format", "{{.Server.Version}}"]);
    return true;
  } catch {
    return false;
  }
}

function dockerUnavailableHint(): string {
  return process.platform === "win32" || process.platform === "darwin"
    ? "Start Docker Desktop and wait until it shows Running."
    : "Start the Docker Engine service (e.g. sudo systemctl start docker).";
}

/** Print a startup WARNING when the Docker daemon is not reachable. */
export async function warnIfDockerUnavailable(): Promise<boolean> {
  if (await isDockerAvailable()) {
    return true;
  }
  console.warn("WARNING: Docker is not running or not installed.");
  console.warn(`  ${dockerUnavailableHint()}`);
  console.warn(
    "  Add instance is disabled until the daemon is available. Start instance will not work either.",
  );
  return false;
}

/** Block add-instance (and similar) until Docker responds. */
export async function requireDockerAvailable(actionLabel: string): Promise<boolean> {
  if (await isDockerAvailable()) {
    return true;
  }
  console.error(`Cannot ${actionLabel}: Docker is not running or not installed.`);
  console.error(`  ${dockerUnavailableHint()}`);
  return false;
}

export async function getContainerRunState(
  containerName: string,
): Promise<ContainerRunState> {
  try {
    const status = await runDocker([
      "inspect",
      "-f",
      "{{.State.Status}}",
      containerName,
    ]);
    if (status === "running") {
      return "running";
    }
    return "stopped";
  } catch {
    return "missing";
  }
}

export async function imageExists(ref: string): Promise<boolean> {
  try {
    await runDocker(["image", "inspect", ref]);
    return true;
  } catch {
    return false;
  }
}

export async function buildRuntimeImage(packageRoot: string): Promise<void> {
  console.log(`Building Docker image ${RUNTIME_IMAGE}...`);
  await runDocker(["build", "-t", RUNTIME_IMAGE, packageRoot]);
  console.log("Image build finished.");
}

function runtimeEnv(record: InstanceRecord): string[] {
  const env: Record<string, string> = {
    NOTE_AGENT_CONTAINER_NAME: record.containerName,
    NOTE_AGENT_ALLOWED_USER_ID: record.allowedTelegramUserId,
    NOTE_AGENT_GIT_REPO_URL: record.gitRepoUrl,
    NOTE_AGENT_GIT_BRANCH: record.gitBranch,
    NOTE_AGENT_LLM_PROVIDER_ID: record.llm.providerId,
    NOTE_AGENT_RAG_MODEL_ID: record.llm.ragModelId,
    NOTE_AGENT_DIALOGUE_MODEL_ID: record.llm.dialogueModelId,
    TELEGRAM_BOT_TOKEN: record.telegramBotToken,
    GIT_PAT: record.gitPat,
  };
  if (record.llmApiKey) {
    env.LLM_API_KEY = record.llmApiKey;
  }
  if (record.llm.llmBaseUrl) {
    env.NOTE_AGENT_LLM_BASE_URL = record.llm.llmBaseUrl;
  }
  return Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
}

async function getImageId(imageRef: string): Promise<string | null> {
  try {
    return (await runDocker(["image", "inspect", "-f", "{{.Id}}", imageRef])).trim();
  } catch {
    return null;
  }
}

async function getContainerImageId(containerName: string): Promise<string | null> {
  try {
    return (
      await runDocker(["inspect", "-f", "{{.Image}}", containerName])
    ).trim();
  } catch {
    return null;
  }
}

/** True when the container must be recreated to pick up the current runtime image. */
export async function instanceNeedsRuntimeUpgrade(
  containerName: string,
): Promise<boolean> {
  const state = await getContainerRunState(containerName);
  if (state === "missing") {
    return false;
  }

  if (await containerLogsLookLikeOldRuntime(containerName)) {
    return true;
  }

  const containerImage = await getContainerImageId(containerName);
  const latestImage = await getImageId(RUNTIME_IMAGE);
  if (!latestImage) {
    return true;
  }
  if (!containerImage) {
    return true;
  }
  return containerImage !== latestImage;
}

/** Build `note-agent-runtime:latest` from package root (Dockerfile + dist/). */
export async function ensureRuntimeImageBuilt(
  packageRoot: string,
  options?: { force?: boolean },
): Promise<void> {
  await assertDockerfilePresent(packageRoot);
  if (options?.force || !(await imageExists(RUNTIME_IMAGE))) {
    await buildRuntimeImage(packageRoot);
  }
}

async function runNewInstanceContainer(record: InstanceRecord): Promise<void> {
  const userRepo = instanceUserRepoDir(record.containerName);
  const rag = instanceRagDir(record.containerName);
  const extraHosts =
    process.platform === "linux"
      ? ["--add-host", "host.docker.internal:host-gateway"]
      : [];

  const args = [
    "run",
    "-d",
    "--name",
    record.containerName,
    "--restart",
    "unless-stopped",
    ...extraHosts,
    "-v",
    `${userRepo}:${CONTAINER_USER_REPO}`,
    "-v",
    `${rag}:${CONTAINER_RAG}`,
    ...runtimeEnv(record),
    RUNTIME_IMAGE,
  ];
  await runDocker(args);
  console.log(`Created and started container "${record.containerName}".`);
}

export async function startInstanceContainer(
  record: InstanceRecord,
  packageRoot: string,
): Promise<void> {
  const upgrade = await instanceNeedsRuntimeUpgrade(record.containerName);
  const state = await getContainerRunState(record.containerName);

  if (state === "running") {
    if (!upgrade) {
      console.log(`Container "${record.containerName}" is already running.`);
      return;
    }
    console.log(
      `Container "${record.containerName}" is on an old runtime; rebuilding image and recreating...`,
    );
    await removeInstanceContainer(record.containerName);
  } else if (state === "stopped") {
    if (upgrade) {
      console.log(
        `Removing stopped container "${record.containerName}" (outdated runtime)...`,
      );
      await removeInstanceContainer(record.containerName);
    } else {
      await runDocker(["start", record.containerName]);
      console.log(`Started container "${record.containerName}".`);
      await reportInstanceStartup(record.containerName);
      return;
    }
  }

  await ensureRuntimeImageBuilt(packageRoot, { force: upgrade });
  await runNewInstanceContainer(record);
  await reportInstanceStartup(record.containerName);
}

/** Wait for Docker HEALTHCHECK and print recent logs (P2-T07). */
export async function reportInstanceStartup(
  containerName: string,
): Promise<void> {
  console.log("Waiting for gateway bootstrap and healthcheck...");
  const health = await waitForContainerHealthy(containerName, 120_000, (msg) => {
    console.log(`  ${msg}`);
  });
  if (health === "healthy") {
    console.log("Container is healthy (git sync + gateway + worker IPC).");
  } else if (health === "starting") {
    console.log(
      "Container is still starting (git clone can take a while). Check: docker logs " +
        containerName,
    );
  } else {
    console.log(
      `Container health: ${health}. Inspect logs: docker logs ${containerName}`,
    );
    if (await containerLogsLookLikeOldRuntime(containerName)) {
      console.log(
        "Outdated runtime detected. From the main menu use (s) Start — the CLI will rebuild the image and recreate the container automatically.",
      );
    }
  }
  await printRecentContainerLogs(containerName);
}

export async function stopInstanceContainer(containerName: string): Promise<void> {
  const state = await getContainerRunState(containerName);
  if (state === "missing") {
    return;
  }
  if (state === "running") {
    await runDocker(["stop", containerName]);
    console.log(`Stopped container "${containerName}".`);
  }
}

export async function removeInstanceContainer(
  containerName: string,
): Promise<void> {
  const state = await getContainerRunState(containerName);
  if (state === "missing") {
    return;
  }
  await stopInstanceContainer(containerName);
  await runDocker(["rm", "-f", containerName]);
  console.log(`Removed container "${containerName}".`);
}

/** Docker container names: letter/digit first, then [a-zA-Z0-9_.-] */
export function isValidContainerName(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(name);
}

export async function assertDockerfilePresent(
  packageRoot: string,
): Promise<void> {
  try {
    await access(join(packageRoot, "Dockerfile"));
  } catch {
    throw new DockerCliError("Dockerfile not found in package root.");
  }
}
