import type { AgentIpcRequest, AgentIpcResponse } from "./types.js";
import { DEFAULT_IPC_TIMEOUT_MS } from "./types.js";

export interface AgentIpcClientOptions {
  port: number;
  timeoutMs?: number;
}

export class AgentIpcClient {
  readonly #baseUrl: string;
  readonly #timeoutMs: number;

  constructor(options: AgentIpcClientOptions) {
    this.#baseUrl = `http://127.0.0.1:${options.port}`;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_IPC_TIMEOUT_MS;
  }

  async ping(): Promise<Extract<AgentIpcResponse, { type: "pong" }>> {
    const response = await this.#post({ type: "ping" });
    if (!response.ok) {
      throw new Error(response.error);
    }
    if (response.type !== "pong") {
      throw new Error("Unexpected ping response");
    }
    return response;
  }

  async dialog(
    request: Extract<AgentIpcRequest, { type: "dialog" }>,
  ): Promise<Extract<AgentIpcResponse, { type: "dialog" }>> {
    const response = await this.#post(request);
    if (!response.ok) {
      throw new Error(response.error);
    }
    if (response.type !== "dialog") {
      throw new Error("Unexpected dialog response");
    }
    return response;
  }

  async longPost(
    request: Extract<AgentIpcRequest, { type: "longPost" }>,
  ): Promise<Extract<AgentIpcResponse, { type: "longPost" }>> {
    const response = await this.#post(request);
    if (!response.ok) {
      throw new Error(response.error);
    }
    if (response.type !== "longPost") {
      throw new Error("Unexpected longPost response");
    }
    return response;
  }

  async #post(body: AgentIpcRequest): Promise<AgentIpcResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const res = await fetch(`${this.#baseUrl}/v1/agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json = (await res.json()) as AgentIpcResponse;
      if (!res.ok && json.ok === false) {
        return json;
      }
      if (!res.ok) {
        return { ok: false, error: `IPC HTTP ${res.status}` };
      }
      return json;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return { ok: false, error: `IPC timeout after ${this.#timeoutMs}ms` };
      }
      const message =
        error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    } finally {
      clearTimeout(timer);
    }
  }
}
