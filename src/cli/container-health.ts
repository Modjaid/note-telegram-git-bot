import { runDocker } from "./docker.js";

export type ContainerHealthState =
  | "healthy"
  | "starting"
  | "unhealthy"
  | "none"
  | "unknown";

/** Read Docker HEALTHCHECK status for an instance container (P2-T07). */
export async function getContainerHealthState(
  containerName: string,
): Promise<ContainerHealthState> {
  try {
    const raw = await runDocker([
      "inspect",
      "-f",
      "{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}",
      containerName,
    ]);
    const status = raw.trim().toLowerCase();
    if (status === "healthy" || status === "starting" || status === "unhealthy") {
      return status;
    }
    if (status === "none" || status === "") {
      return "none";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

/** True when logs still show the pre-Phase-2 runtime (needs image rebuild + recreate). */
export async function containerLogsLookLikeOldRuntime(
  containerName: string,
): Promise<boolean> {
  try {
    const logs = await runDocker(["logs", "--tail", "15", containerName]);
    return (
      logs.includes("Gateway scaffold ready") ||
      logs.includes("Agent worker scaffold ready")
    );
  } catch {
    return false;
  }
}

/**
 * Probe gateway /health inside the container (works when HEALTHCHECK is missing
 * on containers created before the runtime image defined one).
 */
export async function probeGatewayBootstrapInContainer(
  containerName: string,
): Promise<boolean> {
  try {
    await runDocker([
      "exec",
      containerName,
      "node",
      "-e",
      [
        "fetch('http://127.0.0.1:3711/health')",
        ".then((r)=>r.json())",
        ".then((j)=>process.exit(j.bootstrapComplete?0:1))",
        ".catch(()=>process.exit(2))",
      ].join(""),
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function waitForContainerHealthy(
  containerName: string,
  timeoutMs = 120_000,
  onProgress?: (message: string) => void,
): Promise<ContainerHealthState> {
  const deadline = Date.now() + timeoutMs;
  let polls = 0;

  while (Date.now() < deadline) {
    polls++;
    const state = await getContainerHealthState(containerName);
    if (state === "healthy") {
      return state;
    }
    if (state === "unhealthy") {
      return state;
    }

    if (await probeGatewayBootstrapInContainer(containerName)) {
      return "healthy";
    }

    if (polls === 3 && (await containerLogsLookLikeOldRuntime(containerName))) {
      onProgress?.(
        "Container is still on the old runtime image. Run: npm run build, docker build -t note-agent-runtime:latest ., then remove and recreate this container from the CLI.",
      );
    }

    if (polls % 5 === 0) {
      onProgress?.(
        `Still waiting (docker health: ${state}, ${Math.round((deadline - Date.now()) / 1000)}s left)...`,
      );
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  if (await probeGatewayBootstrapInContainer(containerName)) {
    return "healthy";
  }
  return getContainerHealthState(containerName);
}

export async function printRecentContainerLogs(
  containerName: string,
  tailLines = 25,
): Promise<void> {
  try {
    const logs = await runDocker([
      "logs",
      "--tail",
      String(tailLines),
      containerName,
    ]);
    if (logs.trim()) {
      console.log("\n--- container logs (last lines) ---");
      console.log(logs);
      console.log("--- end logs ---\n");
    }
  } catch {
    // Container may not exist yet.
  }
}
