import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cloneOrPull } from "../git/sync.js";
import { GitWriteService } from "../git/write-service.js";
import {
  ntbCommandsDir,
  ntbConfigDir,
  ntbDailyDir,
  ntbIndexedDir,
  noteTelegramBotRoot,
} from "../paths/index.js";
import type { RuntimeEnv } from "./env.js";

export interface BootstrapResult {
  gitMessage: string;
  scaffolded: boolean;
  scaffoldCommitMessage?: string;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Git sync + `note_telegram_bot/{daily,indexed,config}` scaffold on container start.
 */
export async function runContainerBootstrap(
  env: RuntimeEnv,
): Promise<BootstrapResult> {
  const git = await cloneOrPull({
    repoDir: env.userRepoDir,
    repoUrl: env.gitRepoUrl,
    pat: env.gitPat,
    branch: env.gitBranch,
  });

  const ntbRoot = noteTelegramBotRoot(env.userRepoDir);
  const dirs = [
    ntbRoot,
    ntbDailyDir(env.userRepoDir),
    ntbIndexedDir(env.userRepoDir),
    ntbConfigDir(env.userRepoDir),
    ntbCommandsDir(env.userRepoDir),
  ];

  const hadNtb = await pathExists(ntbRoot);
  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
  }
  const createdAny = !hadNtb;

  if (createdAny) {
    const keep = join(ntbConfigDir(env.userRepoDir), ".gitkeep");
    try {
      await writeFile(keep, "", { flag: "wx" });
    } catch {
      // already exists
    }
  }

  let scaffoldCommitMessage: string | undefined;
  if (createdAny) {
    const writer = new GitWriteService({
      repoDir: env.userRepoDir,
      branch: env.gitBranch,
    });
    const rel = GitWriteService.relativePath(
      env.userRepoDir,
      noteTelegramBotRoot(env.userRepoDir),
    );
    const write = await writer.commitAndPush(
      [rel],
      "note-agent: scaffold note_telegram_bot layout",
    );
    scaffoldCommitMessage = write.message;
  }

  return {
    gitMessage: git.message,
    scaffolded: createdAny,
    scaffoldCommitMessage,
  };
}
