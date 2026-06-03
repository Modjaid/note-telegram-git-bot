import { access } from "node:fs/promises";
import { join } from "node:path";
import { GitWriteService } from "../git/write-service.js";
import { loadInstancesRegistry } from "./instances-registry.js";
import { instanceUserRepoDir } from "../paths/index.js";

export interface GitPushResult {
  attempted: boolean;
  pushed: boolean;
  message: string;
}

/** Push unpushed commits before container stop (P1-T07 / P2-T06). */
export async function pushUserRepoIfNeeded(
  containerName: string,
): Promise<GitPushResult> {
  const repoDir = instanceUserRepoDir(containerName);
  try {
    await access(join(repoDir, ".git"));
  } catch {
    return {
      attempted: false,
      pushed: false,
      message: "No git repo yet in UserRepo (clone happens on container start).",
    };
  }

  const registry = await loadInstancesRegistry();
  const inst = registry.instances.find((i) => i.containerName === containerName);
  const branch = inst?.gitBranch ?? "node_telegram_bot";

  const writer = new GitWriteService({ repoDir, branch });
  const result = await writer.pushIfNeeded();
  return {
    attempted: true,
    pushed: result.pushed,
    message: result.message,
  };
}
