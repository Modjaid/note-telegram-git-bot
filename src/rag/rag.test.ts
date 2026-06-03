import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chunkDailyFile, chunkWholeFile } from "./daily-chunks.js";
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
