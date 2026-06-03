import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { embedPatInHttpsUrl, redactGitUrl } from "./credentials.js";
import { ensureGitIdentity } from "./identity.js";
import { gitOutput, runGit } from "./git-runner.js";
import type { GitSyncResult } from "./types.js";

export interface GitSyncConfig {
  repoDir: string;
  repoUrl: string;
  pat: string;
  branch: string;
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
 * Create and checkout `branch` if missing locally or on origin (Q3).
 */
export async function ensureGitBranch(
  repoDir: string,
  branch: string,
): Promise<void> {
  const local = await runGit(repoDir, ["rev-parse", "--verify", branch]);
  if (local.code === 0) {
    const checkout = await runGit(repoDir, ["checkout", branch]);
    if (checkout.code !== 0) {
      throw new Error(redactGitUrl(gitOutput(checkout)));
    }
    const pull = await runGit(repoDir, ["pull", "--ff-only", "origin", branch]);
    if (pull.code !== 0 && !pull.stderr.includes("couldn't find remote ref")) {
      if (!pull.stderr.includes("Already up to date")) {
        // New branch with no upstream yet is OK before first push.
        if (!pull.stderr.includes("no tracking information")) {
          throw new Error(redactGitUrl(gitOutput(pull)));
        }
      }
    }
    return;
  }

  const remoteHeads = await runGit(repoDir, [
    "ls-remote",
    "--heads",
    "origin",
    branch,
  ]);
  if (remoteHeads.code !== 0) {
    throw new Error(redactGitUrl(gitOutput(remoteHeads)));
  }

  if (remoteHeads.stdout.trim()) {
    const track = await runGit(repoDir, [
      "checkout",
      "-b",
      branch,
      `origin/${branch}`,
    ]);
    if (track.code !== 0) {
      throw new Error(redactGitUrl(gitOutput(track)));
    }
    return;
  }

  const create = await runGit(repoDir, ["checkout", "-b", branch]);
  if (create.code !== 0) {
    throw new Error(redactGitUrl(gitOutput(create)));
  }
  const push = await runGit(repoDir, ["push", "-u", "origin", branch]);
  if (push.code !== 0) {
    throw new Error(redactGitUrl(gitOutput(push)));
  }
}

/** Clone into `repoDir` or pull from origin; then ensure configured branch. */
export async function cloneOrPull(config: GitSyncConfig): Promise<GitSyncResult> {
  const { repoDir, repoUrl, pat, branch } = config;
  const authUrl = embedPatInHttpsUrl(repoUrl, pat);
  const gitDir = join(repoDir, ".git");
  const hasRepo = await pathExists(gitDir);

  await mkdir(repoDir, { recursive: true });

  if (!hasRepo) {
    const clone = await runGit(repoDir, ["clone", authUrl, "."]);
    if (clone.code !== 0) {
      throw new Error(redactGitUrl(gitOutput(clone)));
    }
    await runGit(repoDir, ["remote", "set-url", "origin", authUrl]);
    await ensureGitIdentity(repoDir);
    await ensureGitBranch(repoDir, branch);
    return {
      cloned: true,
      pulled: false,
      branch,
      message: `Cloned repository and checked out branch "${branch}".`,
    };
  }

  await runGit(repoDir, ["remote", "set-url", "origin", authUrl]);
  await ensureGitIdentity(repoDir);
  const fetch = await runGit(repoDir, ["fetch", "origin"]);
  if (fetch.code !== 0) {
    throw new Error(redactGitUrl(gitOutput(fetch)));
  }

  await ensureGitBranch(repoDir, branch);
  const pull = await runGit(repoDir, ["pull", "--ff-only", "origin", branch]);
  const pulled =
    pull.code === 0 &&
    !pull.stdout.includes("Already up to date") &&
    pull.stdout.length > 0;

  if (
    pull.code !== 0 &&
    !pull.stderr.includes("Already up to date") &&
    !pull.stderr.includes("no tracking information")
  ) {
    throw new Error(redactGitUrl(gitOutput(pull)));
  }

  return {
    cloned: false,
    pulled,
    branch,
    message: pulled
      ? `Pulled updates on branch "${branch}".`
      : `Repository up to date on branch "${branch}".`,
  };
}
