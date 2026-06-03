import { runGit } from "./git-runner.js";

/** Local repo identity for bot commits (required before any git commit). */
export async function ensureGitIdentity(repoDir: string): Promise<void> {
  const name = await runGit(repoDir, ["config", "user.name"]);
  if (name.code !== 0 || !name.stdout.trim()) {
    await runGit(repoDir, ["config", "user.name", "NoteAgent Bot"]);
  }
  const email = await runGit(repoDir, ["config", "user.email"]);
  if (email.code !== 0 || !email.stdout.trim()) {
    await runGit(repoDir, ["config", "user.email", "note-agent@local"]);
  }
}
