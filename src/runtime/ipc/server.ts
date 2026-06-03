import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AgentIpcRequest, AgentIpcResponse } from "./types.js";

export interface AgentIpcServerOptions {
  port: number;
  workerVersion: string;
  /** Default dialog handler until ADK is wired (P5+). */
  onDialog?: (
    body: Extract<AgentIpcRequest, { type: "dialog" }>,
  ) => Promise<AgentIpcResponse>;
  onLongPost?: (
    body: Extract<AgentIpcRequest, { type: "longPost" }>,
  ) => Promise<AgentIpcResponse>;
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw) as unknown);
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function startAgentIpcServer(
  options: AgentIpcServerOptions,
): ReturnType<typeof createServer> {
  const server = createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/agent") {
      sendJson(res, 404, { ok: false, error: "Not found" });
      return;
    }

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { ok: false, error: "Invalid JSON body" });
      return;
    }

    const request = body as AgentIpcRequest;
    try {
      const response = await handleRequest(request, options);
      sendJson(res, 200, response);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      sendJson(res, 500, { ok: false, error: message });
    }
  });

  server.listen(options.port, "127.0.0.1", () => {
    console.log(`Agent IPC listening on 127.0.0.1:${options.port}/v1/agent`);
  });

  server.on("error", (error) => {
    console.error(`Agent IPC server error: ${error.message}`);
    process.exit(1);
  });

  return server;
}

async function handleRequest(
  request: AgentIpcRequest,
  options: AgentIpcServerOptions,
): Promise<AgentIpcResponse> {
  if (!request || typeof request !== "object" || !("type" in request)) {
    return { ok: false, error: "Missing request type" };
  }

  if (request.type === "ping") {
    return { ok: true, type: "pong", workerVersion: options.workerVersion };
  }

  if (request.type === "dialog") {
    if (options.onDialog) {
      return options.onDialog(request);
    }
    return {
      ok: true,
      type: "dialog",
      sessionId: request.sessionId,
      replies: [
        {
          chatId: request.message.chatId,
          text:
            "Agent worker is running. ADK dialog handling will be added in Phase 7.",
        },
      ],
    };
  }

  if (request.type === "longPost") {
    if (options.onLongPost) {
      return options.onLongPost(request);
    }
    return { ok: false, error: "Long-post handler not configured." };
  }

  return { ok: false, error: `Unknown request type` };
}
