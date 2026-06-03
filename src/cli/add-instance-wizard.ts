import { rm } from "node:fs/promises";
import { DEFAULT_GIT_BRANCH, type InstanceRecord } from "../config/types.js";
import { loadLlmModelsCatalog } from "../config/llm-catalog-loader.js";
import type { InstancesRegistry } from "../config/types.js";
import { findInstance } from "./instances-registry.js";
import {
  assertDockerfilePresent,
  buildRuntimeImage,
  DockerCliError,
  imageExists,
  isValidContainerName,
  requireDockerAvailable,
  RUNTIME_IMAGE,
  startInstanceContainer,
} from "./docker.js";
import { ensureInstanceHostDirs } from "./instance-dirs.js";
import { pickLlmConfiguration } from "./llm-picker.js";
import type { PromptSession } from "./prompt.js";
import { DEFAULT_GIT_REPO_URL } from "./defaults.js";
import { promptNonEmpty, promptWithDefault } from "./prompt.js";
import { instanceDataDir } from "../paths/index.js";

export async function runAddInstanceWizard(
  session: PromptSession,
  registry: InstancesRegistry,
  packageRoot: string,
): Promise<InstanceRecord | null> {
  if (!(await requireDockerAvailable("add an instance"))) {
    return null;
  }

  console.log("\n--- Add new instance ---\n");
  console.log(
    "Enter all settings first; nothing is saved until the container starts successfully.\n",
  );

  const containerName = await promptNonEmpty(
    session,
    "Docker container name",
  );
  if (!isValidContainerName(containerName)) {
    console.log(
      "Invalid name. Use letters, digits, underscore, dot, or hyphen; start with alphanumeric.",
    );
    return null;
  }
  if (findInstance(registry, containerName)) {
    console.log(`Instance "${containerName}" already exists.`);
    return null;
  }

  const telegramBotToken = await promptNonEmpty(session, "Telegram bot token");
  const catalog = await loadLlmModelsCatalog(packageRoot);
  const { llm, llmApiKey } = await pickLlmConfiguration(session, catalog);
  const allowedTelegramUserId = await promptNonEmpty(
    session,
    "Allowed Telegram user id",
  );
  const gitPat = await promptNonEmpty(session, "Git personal access token (PAT)");
  const gitRepoUrl = DEFAULT_GIT_REPO_URL
    ? await promptWithDefault(
        session,
        "Git repository URL",
        DEFAULT_GIT_REPO_URL,
      )
    : await promptNonEmpty(
        session,
        "Git repository URL (HTTPS, e.g. https://github.com/you/your-notes.git)",
      );
  const gitBranch = await promptWithDefault(
    session,
    "Git branch",
    DEFAULT_GIT_BRANCH,
  );

  const now = new Date().toISOString();
  const record: InstanceRecord = {
    containerName,
    telegramBotToken,
    llm,
    llmApiKey,
    allowedTelegramUserId,
    gitPat,
    gitRepoUrl,
    gitBranch,
    createdAt: now,
  };

  console.log("\nAll settings collected. Creating host dirs and container...\n");

  let dirsCreated = false;
  try {
    const dirs = await ensureInstanceHostDirs(containerName);
    dirsCreated = true;
    console.log(`Host directories ready:`);
    console.log(`  UserRepo: ${dirs.userRepo}`);
    console.log(`  rag: ${dirs.rag}`);

    await assertDockerfilePresent(packageRoot);
    if (!(await imageExists(RUNTIME_IMAGE))) {
      await buildRuntimeImage(packageRoot);
    }
    await startInstanceContainer(record, packageRoot);
    console.log(
      "\nInstance is up. Send Telegram messages to the bot; daily note files follow in Phase 4.",
    );
    return record;
  } catch (error) {
    const message =
      error instanceof DockerCliError || error instanceof Error
        ? error.message
        : String(error);
    console.error(`\nSetup failed: ${message}`);
    console.log("Instance was not saved. Fix the issue and run Add instance again.");
    if (dirsCreated) {
      await rm(instanceDataDir(containerName), {
        recursive: true,
        force: true,
      });
      console.log(`Removed incomplete host data for "${containerName}".`);
    }
    return null;
  }
}
