/**
 * Container entrypoint: supervise gateway + agent worker (restart children on crash).
 * LLM_API_KEY is passed only to the worker process (P2-T08).
 */
import { spawn } from "node:child_process";

let shuttingDown = false;
const children = new Map();

function envWithout(keys) {
  const out = { ...process.env };
  for (const key of keys) {
    delete out[key];
  }
  return out;
}

const gatewayEnv = envWithout(["LLM_API_KEY"]);
const workerEnv = { ...process.env };

function startChild(name, scriptPath, childEnv) {
  const child = spawn("node", [scriptPath], {
    stdio: "inherit",
    env: childEnv,
  });
  children.set(name, child);

  child.on("exit", (code, signal) => {
    children.delete(name);
    if (shuttingDown) {
      return;
    }
    console.error(
      `[entrypoint] ${name} exited (code=${code ?? "null"}, signal=${signal ?? "none"}); restarting in 2s...`,
    );
    setTimeout(() => {
      if (!shuttingDown) {
        startChild(name, scriptPath, childEnv);
      }
    }, 2000);
  });
}

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children.values()) {
    child.kill(signal);
  }
  setTimeout(() => process.exit(0), 5000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

startChild("gateway", "/app/dist/runtime/gateway/main.js", gatewayEnv);
startChild("worker", "/app/dist/runtime/agent-worker/main.js", workerEnv);

await new Promise(() => {});
