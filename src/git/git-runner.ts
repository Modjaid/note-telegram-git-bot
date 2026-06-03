import { spawn } from "node:child_process";

export interface GitRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run git in `cwd`; returns exit code and captured output. */
export function runGit(cwd: string, args: string[]): Promise<GitRunResult> {
  return new Promise((resolve) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", () => {
      resolve({
        code: -1,
        stdout: "",
        stderr: "git not found on PATH",
      });
    });
    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

export function gitOutput(result: GitRunResult): string {
  return result.stderr || result.stdout;
}
