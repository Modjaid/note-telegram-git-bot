import type { AgentIpcRequest, AgentIpcResponse } from "../ipc/types.js";
import type { RuntimeEnv } from "../env.js";
import { LongPostProcessor } from "./long-post/processor.js";

export function createLongPostIpcHandler(
  env: RuntimeEnv,
): (
  body: Extract<AgentIpcRequest, { type: "longPost" }>,
) => Promise<AgentIpcResponse> {
  const processor = new LongPostProcessor(env);

  return async (body) => {
    const text = body.text.trim();
    if (!text) {
      return { ok: false, error: "Long-post text is empty." };
    }

    try {
      const result = await processor.process({ text });
      return {
        ok: true,
        type: "longPost",
        fileName: result.fileName,
        shortDescription: result.shortDescription,
        indexedRelativePath: result.indexedRelativePath,
        tags: result.tags,
        wikilinks: result.wikilinks,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
  };
}
