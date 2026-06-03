import { relative } from "node:path";
import { ensureGitIdentity } from "./identity.js";
import { gitOutput, runGit } from "./git-runner.js";
import { redactGitUrl } from "./credentials.js";
import type { GitWriteResult } from "./types.js";

export interface GitWriteServiceOptions {
  repoDir: string;
  branch: string;
}

/**
 * After every UserRepo mutation: add, commit, push immediately (P2-T05).
 */
export class GitWriteService {
  readonly #repoDir: string;
  readonly #branch: string;

  constructor(options: GitWriteServiceOptions) {
    this.#repoDir = options.repoDir;
    this.#branch = options.branch;
  }

  get repoDir(): string {
    return this.#repoDir;
  }

  async commitAndPush(
    relativePaths: string[],
    message: string,
  ): Promise<GitWriteResult> {
    await ensureGitIdentity(this.#repoDir);
    for (const rel of relativePaths) {
      const add = await runGit(this.#repoDir, ["add", "--", rel]);
      if (add.code !== 0) {
        return {
          committed: false,
          pushed: false,
          message: redactGitUrl(gitOutput(add)),
        };
      }
    }
    return this.#commitAndPush(message);
  }

  async commitAllAndPush(message: string): Promise<GitWriteResult> {
    await ensureGitIdentity(this.#repoDir);
    const add = await runGit(this.#repoDir, ["add", "-A"]);
    if (add.code !== 0) {
      return {
        committed: false,
        pushed: false,
        message: redactGitUrl(gitOutput(add)),
      };
    }
    return this.#commitAndPush(message);
  }

  async #commitAndPush(message: string): Promise<GitWriteResult> {
    const commit = await runGit(this.#repoDir, ["commit", "-m", message]);
    if (commit.code !== 0) {
      const out = gitOutput(commit);
      if (out.includes("nothing to commit")) {
        const pushOnly = await this.#push();
        return {
          committed: false,
          pushed: pushOnly.pushed,
          message: pushOnly.message,
        };
      }
      return { committed: false, pushed: false, message: redactGitUrl(out) };
    }

    const push = await this.#push();
    return {
      committed: true,
      pushed: push.pushed,
      message: push.pushed
        ? "Committed and pushed to remote."
        : `Committed locally; push failed: ${push.message}`,
    };
  }

  async #push(): Promise<{ pushed: boolean; message: string }> {
    const push = await runGit(this.#repoDir, [
      "push",
      "origin",
      this.#branch,
    ]);
    if (push.code !== 0) {
      const out = redactGitUrl(gitOutput(push));
      if (out.includes("Everything up-to-date")) {
        return { pushed: true, message: "Remote already up to date." };
      }
      return { pushed: false, message: out };
    }
    return { pushed: true, message: "Pushed to remote." };
  }

  /** Push any unpushed commits (pre-stop / CLI restart). */
  async pushIfNeeded(): Promise<GitWriteResult> {
    const status = await runGit(this.#repoDir, ["status", "--porcelain"]);
    if (status.code !== 0) {
      return {
        committed: false,
        pushed: false,
        message: redactGitUrl(gitOutput(status)),
      };
    }
    if (status.stdout.length > 0) {
      return this.commitAllAndPush("note-agent: sync before shutdown");
    }
    const push = await this.#push();
    return {
      committed: false,
      pushed: push.pushed,
      message: push.message,
    };
  }

  /** Relative path under repo root for a UserRepo file. */
  static relativePath(repoDir: string, absolutePath: string): string {
    return relative(repoDir, absolutePath).replace(/\\/g, "/");
  }
}
