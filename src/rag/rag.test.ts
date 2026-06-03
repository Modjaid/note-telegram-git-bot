import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chunkDailyFile, chunkWholeFile } from "./daily-chunks.js";
import { buildRagChunks } from "./chunk-metadata.js";
import {
  discoverRagIndexablePaths,
  isRagIndexablePath,
} from "./indexable-paths.js";
import { chunkIdFor, cosineSimilarity } from "./store.js";

describe("chunkDailyFile", () => {
  it("splits log entries into separate chunks", () => {
    const content = [
      "09:15:00 Morning note",
      "",
      "09:15:01 Second in same minute",
      "10:00:00 Later entry",
    ].join("\n");
    assert.deepEqual(chunkDailyFile(content), [
      "09:15:00 Morning note",
      "09:15:01 Second in same minute",
      "10:00:00 Later entry",
    ]);
  });

  it("ignores non-log lines", () => {
    const content = "# Header\n\n12:00:00 Valid line\nFooter text";
    assert.deepEqual(chunkDailyFile(content), ["12:00:00 Valid line"]);
  });
});

describe("chunkWholeFile", () => {
  it("returns one chunk for non-empty content", () => {
    assert.deepEqual(chunkWholeFile("  hello world  "), ["hello world"]);
  });

  it("returns empty array for blank content", () => {
    assert.deepEqual(chunkWholeFile("  \n  "), []);
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    assert.equal(cosineSimilarity([1, 0, 0], [1, 0, 0]), 1);
  });

  it("returns 0 for orthogonal vectors", () => {
    assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  });
});

describe("chunkIdFor", () => {
  it("builds stable chunk ids", () => {
    assert.equal(
      chunkIdFor("note_telegram_bot/daily/02_Jun_2026.md", 2),
      "note_telegram_bot/daily/02_Jun_2026.md#2",
    );
  });
});

describe("isRagIndexablePath", () => {
  it("accepts daily, indexed, and repo-root markdown", () => {
    assert.equal(
      isRagIndexablePath("note_telegram_bot/daily/02_Jun_2026.md"),
      true,
    );
    assert.equal(
      isRagIndexablePath("note_telegram_bot/indexed/post.md"),
      true,
    );
    assert.equal(isRagIndexablePath("docs/notes.md"), true);
  });

  it("rejects config, .git, binaries, and extensionless files", () => {
    assert.equal(
      isRagIndexablePath("note_telegram_bot/config/commands/foo.md"),
      false,
    );
    assert.equal(isRagIndexablePath(".git/config"), false);
    assert.equal(isRagIndexablePath("assets/photo.png"), false);
    assert.equal(isRagIndexablePath("README"), false);
  });
});

describe("buildRagChunks", () => {
  it("attaches daily note metadata", () => {
    const content = "09:15:00 Morning note\n\n10:00:01 Later";
    const chunks = buildRagChunks(
      "note_telegram_bot/daily/02_Jun_2026.md",
      content,
    );
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].metadata.chunkType, "daily_log");
    assert.equal(chunks[0].metadata.logicalDay, "02_Jun_2026");
    assert.equal(chunks[0].metadata.noteId, "2026:Jun:02:09:15:00");
  });

  it("splits long post indexed files into summary and body", () => {
    const content = [
      "# post",
      "",
      "## Summary",
      "Short desc",
      "",
      "## Tags",
      "#health",
      "",
      "---",
      "",
      "Full body text",
    ].join("\n");
    const chunks = buildRagChunks(
      "note_telegram_bot/indexed/post.md",
      content,
    );
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].metadata.chunkType, "indexed_summary");
    assert.equal(chunks[1].metadata.chunkType, "indexed_body");
  });

  it("parses command output header and AILogs", () => {
    const content = [
      "CommandId: cmd-1",
      "Period: from 01_May_2026 to 07_May_2026",
      "",
      "## Summary",
      "Weekly recap",
      "",
      "## AILogs",
      "2026:May:03:10:00:00 note one",
    ].join("\n");
    const chunks = buildRagChunks(
      "note_telegram_bot/indexed/health_sum_07_May_2026.md",
      content,
    );
    assert.equal(chunks[0].metadata.chunkType, "command_summary");
    assert.equal(chunks[0].metadata.commandId, "cmd-1");
    assert.equal(chunks[1].metadata.chunkType, "command_ailog");
    assert.equal(chunks[1].metadata.noteId, "2026:May:03:10:00:00");
  });
});

describe("discoverRagIndexablePaths", () => {
  it("walks UserRepo and skips config and .git", async () => {
    const root = await mkdtemp(join(tmpdir(), "rag-discover-"));
    try {
      await mkdir(join(root, "note_telegram_bot", "daily"), {
        recursive: true,
      });
      await mkdir(join(root, "note_telegram_bot", "config", "commands"), {
        recursive: true,
      });
      await mkdir(join(root, "docs"), { recursive: true });
      await mkdir(join(root, ".git"), { recursive: true });
      await writeFile(join(root, "README.md"), "# root");
      await writeFile(
        join(root, "note_telegram_bot", "daily", "02_Jun_2026.md"),
        "09:00:00 note",
      );
      await writeFile(
        join(root, "note_telegram_bot", "config", "commands", "x.md"),
        "secret",
      );
      await writeFile(join(root, "docs", "guide.md"), "guide");
      await writeFile(join(root, ".git", "HEAD"), "ref");
      await writeFile(join(root, "image.png"), "binary");

      const paths = await discoverRagIndexablePaths(root);
      assert.deepEqual(paths, [
        "README.md",
        "docs/guide.md",
        "note_telegram_bot/daily/02_Jun_2026.md",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
