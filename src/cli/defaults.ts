/**
 * Optional personal default Git remote — set only on your machine, never committed:
 *   NOTE_AGENT_DEFAULT_GIT_REPO_URL=https://github.com/you/your-notes.git
 */
export const DEFAULT_GIT_REPO_URL =
  process.env.NOTE_AGENT_DEFAULT_GIT_REPO_URL?.trim() ?? "";
