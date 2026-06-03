/**
 * Embed a PAT into an HTTPS git remote URL without logging the token.
 */
export function embedPatInHttpsUrl(repoUrl: string, pat: string): string {
  const trimmed = repoUrl.trim();
  if (!trimmed.startsWith("https://")) {
    throw new Error("Git repository URL must use HTTPS for PAT authentication.");
  }
  const withoutScheme = trimmed.slice("https://".length);
  if (withoutScheme.includes("@")) {
    const at = withoutScheme.indexOf("@");
    const hostAndPath = withoutScheme.slice(at + 1);
    return `https://x-access-token:${encodeURIComponent(pat)}@${hostAndPath}`;
  }
  return `https://x-access-token:${encodeURIComponent(pat)}@${withoutScheme}`;
}

/** Strip credentials from URLs before surfacing errors to logs. */
export function redactGitUrl(text: string): string {
  return text.replace(/https:\/\/[^@\s]+@/g, "https://***@");
}
