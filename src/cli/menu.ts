import { loadLlmModelsCatalog } from "../config/llm-catalog-loader.js";
import type { InstancesRegistry } from "../config/types.js";
import {
  getContainerRunState,
  isDockerAvailable,
  removeInstanceContainer,
  requireDockerAvailable,
  startInstanceContainer,
  stopInstanceContainer,
  type ContainerRunState,
} from "./docker.js";
import { pushUserRepoIfNeeded } from "./git-host.js";
import { runAddInstanceWizard } from "./add-instance-wizard.js";
import {
  loadInstancesRegistry,
  removeInstance,
  saveInstancesRegistry,
  upsertInstance,
} from "./instances-registry.js";
import { createPromptSession, confirm } from "./prompt.js";
import { getPackageRoot, getVersion } from "./package-info.js";
import { rm } from "node:fs/promises";
import { instanceDataDir } from "../paths/index.js";

function formatState(state: ContainerRunState): string {
  switch (state) {
    case "running":
      return "running";
    case "stopped":
      return "stopped";
    default:
      return "not created";
  }
}

async function listInstances(registry: InstancesRegistry): Promise<void> {
  if (registry.instances.length === 0) {
    console.log("No instances yet. Use (a) to add one.");
    return;
  }
  console.log("");
  for (let i = 0; i < registry.instances.length; i++) {
    const inst = registry.instances[i]!;
    const state = await getContainerRunState(inst.containerName);
    console.log(
      `  ${i + 1}) ${inst.containerName} [${formatState(state)}] — ${inst.gitRepoUrl}`,
    );
  }
}

async function pickInstance(
  registry: InstancesRegistry,
  action: string,
): Promise<(typeof registry.instances)[number] | null> {
  if (registry.instances.length === 0) {
    console.log("No instances configured.");
    return null;
  }
  const session = createPromptSession();
  try {
    const labels = registry.instances.map((i) => i.containerName);
    const index = await session.chooseIndex(`${action}:`, labels);
    return registry.instances[index] ?? null;
  } finally {
    session.close();
  }
}

async function restartInstanceFlow(
  registry: InstancesRegistry,
  packageRoot: string,
): Promise<InstancesRegistry> {
  const inst = await pickInstance(registry, "Restart instance");
  if (!inst) {
    return registry;
  }

  console.log(`\nRestarting "${inst.containerName}"...`);
  const push = await pushUserRepoIfNeeded(inst.containerName);
  console.log(push.message);
  if (push.attempted && !push.pushed) {
    console.log("Warning: push failed; continuing stop anyway.");
  }

  await stopInstanceContainer(inst.containerName);

  const session = createPromptSession();
  try {
    const startAgain = await confirm(
      session,
      "Start the container again now?",
    );
    if (startAgain) {
      await startInstanceContainer(inst, packageRoot);
      console.log("Container started.");
    } else {
      console.log("Container stopped. Start later from the main menu.");
    }
  } finally {
    session.close();
  }
  return registry;
}

async function deleteInstanceFlow(
  registry: InstancesRegistry,
): Promise<InstancesRegistry> {
  const inst = await pickInstance(registry, "Delete instance");
  if (!inst) {
    return registry;
  }

  const session = createPromptSession();
  try {
    const ok = await confirm(
      session,
      `Delete "${inst.containerName}" (container, registry entry, and host data)?`,
    );
    if (!ok) {
      console.log("Cancelled.");
      return registry;
    }
    const wipeData = await confirm(
      session,
      "Also remove host data under ~/.note-agent/instances/<name>?",
    );
    await removeInstanceContainer(inst.containerName);
    let next = removeInstance(registry, inst.containerName);
    if (wipeData) {
      await rm(instanceDataDir(inst.containerName), {
        recursive: true,
        force: true,
      });
      console.log("Host data removed.");
    }
    await saveInstancesRegistry(next);
    console.log(`Instance "${inst.containerName}" removed from registry.`);
    return next;
  } finally {
    session.close();
  }
}

export async function runMainMenu(): Promise<void> {
  const packageRoot = getPackageRoot();
  await loadLlmModelsCatalog(packageRoot);

  let registry = await loadInstancesRegistry();
  const session = createPromptSession();

  try {
    for (;;) {
      console.log(`\nnote-agent v${getVersion()}`);
      await listInstances(registry);

      const dockerOk = await isDockerAvailable();
      const choice = await session.choose("Main menu", [
        {
          key: "a",
          label: dockerOk
            ? "Add instance"
            : "Add instance (Docker required — not available)",
        },
        { key: "r", label: "Restart instance (git push, then stop)" },
        { key: "s", label: "Start stopped instance" },
        { key: "d", label: "Delete instance" },
        { key: "q", label: "Quit" },
      ] as const);

      if (choice === "q") {
        break;
      }

      if (choice === "a") {
        if (!(await requireDockerAvailable("add an instance"))) {
          continue;
        }
        const record = await runAddInstanceWizard(
          session,
          registry,
          packageRoot,
        );
        if (record) {
          registry = upsertInstance(registry, record);
          await saveInstancesRegistry(registry);
          console.log(`Saved "${record.containerName}" to ~/.note-agent/instances.json`);
        }
        continue;
      }

      if (choice === "r") {
        registry = await restartInstanceFlow(registry, packageRoot);
        continue;
      }

      if (choice === "s") {
        const inst = await pickInstance(registry, "Start instance");
        if (inst) {
          await startInstanceContainer(inst, packageRoot);
        }
        continue;
      }

      if (choice === "d") {
        registry = await deleteInstanceFlow(registry);
        continue;
      }
    }
  } finally {
    session.close();
  }
}
