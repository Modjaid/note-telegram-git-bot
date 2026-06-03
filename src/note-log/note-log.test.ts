import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getLogicalDay, logicalDayFileName } from "./logical-day.js";
import { nextIndexForMinute, formatLogLine } from "./daily-writer.js";
import { parseTimezoneInput, isValidTimezone } from "./timezone.js";
import {
  buildLongPostDailyType,
  sanitizeIndexedFileName,
} from "./indexed-file.js";
import { isLongPost } from "./word-count.js";

function utcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
): number {
  return Date.UTC(year, month - 1, day, hour, minute, 0);
}

describe("getLogicalDay", () => {
  it("uses same calendar day at or after 06:00 local", () => {
    const utcSeconds = utcMs(2026, 6, 2, 6, 0) / 1000;
    assert.deepEqual(getLogicalDay(utcSeconds, "UTC"), {
      dd: 2,
      mmm: "Jun",
      yyyy: 2026,
    });
  });

  it("uses previous calendar day before 06:00 local", () => {
    const utcSeconds = utcMs(2026, 6, 2, 5, 59) / 1000;
    assert.deepEqual(getLogicalDay(utcSeconds, "UTC"), {
      dd: 1,
      mmm: "Jun",
      yyyy: 2026,
    });
  });

  it("respects timezone offset for the 06:00 boundary", () => {
    // 2026-06-02 03:59 UTC = 2026-06-02 05:59 Europe/Berlin (CEST)
    const beforeSix = utcMs(2026, 6, 2, 3, 59) / 1000;
    assert.deepEqual(getLogicalDay(beforeSix, "Europe/Berlin"), {
      dd: 1,
      mmm: "Jun",
      yyyy: 2026,
    });

    // 2026-06-02 04:00 UTC = 2026-06-02 06:00 Europe/Berlin
    const atSix = utcMs(2026, 6, 2, 4, 0) / 1000;
    assert.deepEqual(getLogicalDay(atSix, "Europe/Berlin"), {
      dd: 2,
      mmm: "Jun",
      yyyy: 2026,
    });
  });
});

describe("logicalDayFileName", () => {
  it("formats DD_MMM_YYYY.md", () => {
    const utcSeconds = utcMs(2026, 6, 2, 10, 0) / 1000;
    assert.equal(logicalDayFileName(utcSeconds, "UTC"), "02_Jun_2026.md");
  });
});

describe("nextIndexForMinute", () => {
  it("starts at 00 for an empty file", () => {
    assert.equal(nextIndexForMinute("", "12", "02"), 0);
  });

  it("increments within the same minute", () => {
    const content = [
      "12:02:00 First note",
      "12:02:01 Second note",
      "12:03:00 Other minute",
    ].join("\n");
    assert.equal(nextIndexForMinute(content, "12", "02"), 2);
    assert.equal(nextIndexForMinute(content, "12", "03"), 1);
  });
});

describe("formatLogLine", () => {
  it("omits type for plain notes", () => {
    assert.equal(formatLogLine("08", "30", 0, undefined, "Buy milk"), "08:30:00 Buy milk");
  });

  it("includes type for forwarded notes", () => {
    assert.equal(
      formatLogLine("09", "00", 1, "forwarded from @alice", "Hello"),
      "09:00:01 forwarded from @alice Hello",
    );
  });
});

describe("word count", () => {
  it("detects long posts above 60 words", () => {
    const words = Array.from({ length: 61 }, (_, index) => `word${index}`).join(
      " ",
    );
    assert.equal(isLongPost(words), true);
    assert.equal(isLongPost("one two three"), false);
  });
});

describe("indexed file helpers", () => {
  it("sanitizes filenames", () => {
    assert.equal(
      sanitizeIndexedFileName("My Long Note.md"),
      "my_long_note.md",
    );
  });

  it("builds combined forward + long daily type", () => {
    assert.equal(
      buildLongPostDailyType("notes.md", true, "alice"),
      "forwarded from @alice + Long notes.md",
    );
    assert.equal(buildLongPostDailyType("notes.md", false), "Long notes.md");
  });
});

describe("timezone parsing", () => {
  it("accepts valid IANA names", () => {
    assert.equal(isValidTimezone("Europe/Berlin"), true);
    assert.equal(parseTimezoneInput("  America/New_York "), "America/New_York");
  });

  it("resolves city aliases", () => {
    assert.equal(parseTimezoneInput("moscow"), "Europe/Moscow");
    assert.equal(parseTimezoneInput("Moscow"), "Europe/Moscow");
    assert.equal(parseTimezoneInput("  Berlin "), "Europe/Berlin");
    assert.equal(parseTimezoneInput("nyc"), "America/New_York");
  });

  it("rejects invalid names", () => {
    assert.equal(isValidTimezone("Not/A_Timezone"), false);
    assert.equal(parseTimezoneInput("Not/A_Timezone"), null);
    assert.equal(parseTimezoneInput("/agent"), null);
    assert.equal(parseTimezoneInput("unknowncity123"), null);
  });
});
