import type { AgentIpcClient } from "../ipc/client.js";
import type { LongPostClient, LongPostClientResult } from "../../note-log/long-post-client.js";

export class IpcLongPostClient implements LongPostClient {
  readonly #ipc: AgentIpcClient;

  constructor(ipc: AgentIpcClient) {
    this.#ipc = ipc;
  }

  async process(text: string): Promise<LongPostClientResult> {
    const response = await this.#ipc.longPost({ type: "longPost", text });
    return {
      fileName: response.fileName,
      shortDescription: response.shortDescription,
      indexedRelativePath: response.indexedRelativePath,
    };
  }
}
