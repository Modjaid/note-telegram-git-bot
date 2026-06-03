import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GitWriteService } from "../../../git/write-service.js";
import { ntbIndexedDir } from "../../../paths/index.js";
import {
  formatIndexedMarkdown,
  sanitizeIndexedFileName,
} from "../../../note-log/indexed-file.js";
import type { RuntimeEnv } from "../../env.js";
import { getWorkerRagService } from "../rag-runtime.js";
import { analyzeLongPostText } from "./adk-agent.js";

export interface LongPostProcessInput {
  text: string;
}

export interface LongPostProcessResult {
  fileName: string;
  shortDescription: string;
  indexedRelativePath: string;
  tags: string[];
  wikilinks: string[];
}

export class LongPostProcessor {
  readonly #env: RuntimeEnv;
  readonly #gitWriter: GitWriteService;

  constructor(env: RuntimeEnv) {
    this.#env = env;
    this.#gitWriter = new GitWriteService({
      repoDir: env.userRepoDir,
      branch: env.gitBranch,
    });
  }

  async process(input: LongPostProcessInput): Promise<LongPostProcessResult> {
    const analysis = await analyzeLongPostText(this.#env, input.text);
    const fileName = sanitizeIndexedFileName(analysis.fileName);
    const rag = getWorkerRagService(this.#env);

    const wikilinks = await rag.findSimilarFiles(
      `${analysis.shortDescription}\n${input.text}`,
    );

    const body = formatIndexedMarkdown({
      fileName,
      shortDescription: analysis.shortDescription,
      tags: analysis.tags,
      wikilinks,
      fullText: input.text,
    });

    const indexedDir = ntbIndexedDir(this.#env.userRepoDir);
    await mkdir(indexedDir, { recursive: true });
    const absolutePath = join(indexedDir, fileName);
    await writeFile(absolutePath, body, "utf8");

    const indexedRelativePath = GitWriteService.relativePath(
      this.#env.userRepoDir,
      absolutePath,
    );
    await this.#gitWriter.commitAndPush(
      [indexedRelativePath],
      `note-agent: long post ${fileName}`,
    );

    await rag.reconcilePaths([indexedRelativePath]);

    return {
      fileName,
      shortDescription: analysis.shortDescription,
      indexedRelativePath,
      tags: analysis.tags,
      wikilinks,
    };
  }
}
