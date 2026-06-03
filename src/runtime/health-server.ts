import { createServer } from "node:http";

export interface HealthSnapshot {
  status: "starting" | "ok" | "degraded";
  gateway: true;
  bootstrapComplete: boolean;
  gitMessage?: string;
  worker?: { reachable: boolean; version?: string; error?: string };
}

export function startGatewayHealthServer(
  port: number,
  getSnapshot: () => HealthSnapshot,
): ReturnType<typeof createServer> {
  const server = createServer((req, res) => {
    if (req.url !== "/health" || req.method !== "GET") {
      res.writeHead(404);
      res.end();
      return;
    }
    const snapshot = getSnapshot();
    const statusCode = snapshot.bootstrapComplete ? 200 : 503;
    const body = JSON.stringify(snapshot);
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(body);
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Gateway health on 127.0.0.1:${port}/health`);
  });

  return server;
}
