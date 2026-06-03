import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GitWriteService } from "../git/write-service.js";
import { ntbDailyDir } from "../paths/index.js";
import { logicalDayFileName } from "./logical-day.js";
import { formatLocalClock } from "./timezone.js";

export interface NoteLogEntryInput {
  utcSeconds: number;
  timezone: string;
  /** Omitted for plain short messages. */
  type?: string;
  note: string;
}

export interface DailyWriteResult {
  dailyRelativePath: string;
  line: string;
  fileName: string;
  gitMessage: string;
}

const LOG_LINE_PATTERN = /^(\d{2}):(\d{2}):(\d{2})\s+(.*)$/;

/**
 * Append one `<NoteLog>` line to the current logical daily file and git-push.
 */
export class DailyNoteWriter {
  readonly #userRepoDir: string;
  readonly #gitWriter: GitWriteService;

  constructor(userRepoDir: string, gitWriter: GitWriteService) {
    this.#userRepoDir = userRepoDir;
    this.#gitWriter = gitWriter;
  }

  async appendEntry(input: NoteLogEntryInput): Promise<DailyWriteResult> {
    const fileName = logicalDayFileName(input.utcSeconds, input.timezone);
    const dailyDir = ntbDailyDir(this.#userRepoDir);
    await mkdir(dailyDir, { recursive: true });
    const absolutePath = join(dailyDir, fileName);

    const { hh, mm } = formatLocalClock(input.utcSeconds, input.timezone);
    const existing = await this.#readExisting(absolutePath);
    const index = nextIndexForMinute(existing, hh, mm);
    const line = formatLogLine(hh, mm, index, input.type, input.note);

    const separator =
      existing.length > 0 && !existing.endsWith("\n\n") ? "\n\n" : "";
    const prefix = existing.length > 0 ? separator : "";
    await writeFile(absolutePath, `${prefix}${line}\n`, {
      encoding: "utf8",
      flag: existing.length > 0 ? "a" : "w",
    });

    const dailyRelativePath = GitWriteService.relativePath(
      this.#userRepoDir,
      absolutePath,
    );
    const git = await this.#gitWriter.commitAndPush(
      [dailyRelativePath],
      `note-agent: daily note ${fileName}`,
    );

    return {
      dailyRelativePath,
      line,
      fileName,
      gitMessage: git.message,
    };
  }

  async #readExisting(absolutePath: string): Promise<string> {
    try {
      await access(absolutePath);
      return await readFile(absolutePath, "utf8");
    } catch {
      return "";
    }
  }
}

export function formatLogLine(
  hh: string,
  mm: string,
  index: number,
  type: string | undefined,
  note: string,
): string {
  const indexStr = String(index).padStart(2, "0");
  const trimmedNote = note.trim();
  if (type) {
    return `${hh}:${mm}:${indexStr} ${type} ${trimmedNote}`;
  }
  return `${hh}:${mm}:${indexStr} ${trimmedNote}`;
}

/** Next `<Index>` for the given local minute (00, 01, …). */
export function nextIndexForMinute(
  fileContent: string,
  hh: string,
  mm: string,
): number {
  let maxIndex = -1;
  for (const line of fileContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const match = LOG_LINE_PATTERN.exec(trimmed);
    if (!match) {
      continue;
    }
    const [, lineHh, lineMm, indexStr] = match;
    if (lineHh === hh && lineMm === mm) {
      const index = Number.parseInt(indexStr, 10);
      if (Number.isFinite(index) && index > maxIndex) {
        maxIndex = index;
      }
    }
  }
  return maxIndex + 1;
}

export function formatCaptureFeedback(result: DailyWriteResult): string {
  return `Saved to daily/${result.fileName}:\n${result.line}`;
}
