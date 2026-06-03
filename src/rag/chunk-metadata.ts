/** Chunk classification stored in the RAG vector index (P6-T08). */
export type RagChunkType =
  | "daily_log"
  | "indexed_summary"
  | "indexed_body"
  | "command_summary"
  | "command_ailog"
  | "markdown"
  | "plain_text";

export interface RagChunkMetadata {
  chunkType: RagChunkType;
  /** Repo-relative path of the source file. */
  sourcePath: string;
  /** Daily logical day from filename, e.g. 02_Jun_2026. */
  logicalDay?: string;
  /** Full note id: YYYY:MMM:DD:HH:mm:<Index>. */
  noteId?: string;
  /** Daily log `<type>` when present. */
  noteType?: string;
  commandId?: string;
  period?: string;
}

export interface RagTextChunk {
  text: string;
  metadata: RagChunkMetadata;
}

const DAILY_FILE_PATTERN = /^(\d{2})_([A-Za-z]{3})_(\d{4})\.md$/i;
const LOG_LINE_PATTERN = /^(\d{2}):(\d{2}):(\d{2})\s+(.*)$/;
const AILOG_LINE_PATTERN =
  /^(\d{4}):([A-Za-z]{3}):(\d{2}):(\d{2}):(\d{2}):(\d{2})\s+(.*)$/;
const COMMAND_ID_PATTERN = /^CommandId:\s*(.+)$/im;
const PERIOD_PATTERN = /^Period:\s*(.+)$/im;

function parseDailyFileName(fileName: string): {
  logicalDay: string;
  yyyy: string;
  mmm: string;
  dd: string;
} | null {
  const match = DAILY_FILE_PATTERN.exec(fileName);
  if (!match) {
    return null;
  }
  const [, dd, mmm, yyyy] = match;
  return {
    logicalDay: `${dd}_${mmm}_${yyyy}`,
    yyyy,
    mmm,
    dd,
  };
}

function parseDailyLogLine(
  line: string,
  day: { yyyy: string; mmm: string; dd: string },
  sourcePath: string,
): RagTextChunk | null {
  const match = LOG_LINE_PATTERN.exec(line.trim());
  if (!match) {
    return null;
  }
  const [, hh, mm, indexStr, remainder] = match;
  const noteId = `${day.yyyy}:${day.mmm}:${day.dd}:${hh}:${mm}:${indexStr}`;
  const { noteType, noteText } = splitDailyTypeAndNote(remainder);
  const text = noteType ? `${hh}:${mm}:${indexStr} ${noteType} ${noteText}` : line.trim();
  return {
    text,
    metadata: {
      chunkType: "daily_log",
      sourcePath,
      logicalDay: `${day.dd}_${day.mmm}_${day.yyyy}`,
      noteId,
      noteType,
    },
  };
}

function splitDailyTypeAndNote(remainder: string): {
  noteType?: string;
  noteText: string;
} {
  const trimmed = remainder.trim();
  if (
    trimmed.startsWith("Long ") ||
    trimmed.startsWith("forwarded from ") ||
    trimmed.startsWith("Post ") ||
    trimmed.startsWith("Summary from ")
  ) {
    const space = trimmed.indexOf(" ");
    if (space > 0) {
      return {
        noteType: trimmed.slice(0, space),
        noteText: trimmed.slice(space + 1).trim(),
      };
    }
  }
  return { noteText: trimmed };
}

function parseIndexedHeader(content: string): {
  commandId?: string;
  period?: string;
} {
  const head = content.slice(0, 4000);
  const commandId = COMMAND_ID_PATTERN.exec(head)?.[1]?.trim();
  const period = PERIOD_PATTERN.exec(head)?.[1]?.trim();
  return { commandId, period };
}

function sectionSlice(
  content: string,
  heading: string,
  nextHeadings: string[],
): string {
  const startRe = new RegExp(`^## ${heading}\\s*$`, "im");
  const startMatch = startRe.exec(content);
  if (!startMatch) {
    return "";
  }
  const bodyStart = startMatch.index + startMatch[0].length;
  let end = content.length;
  for (const next of nextHeadings) {
    const nextRe = new RegExp(`^## ${next}\\s*$`, "im");
    const nextMatch = nextRe.exec(content.slice(bodyStart));
    if (nextMatch?.index !== undefined) {
      end = Math.min(end, bodyStart + nextMatch.index);
    }
  }
  return content.slice(bodyStart, end).trim();
}

function chunkIndexedFile(
  relativePath: string,
  content: string,
): RagTextChunk[] {
  const header = parseIndexedHeader(content);
  if (header.commandId) {
    return chunkCommandOutput(relativePath, content, header);
  }
  return chunkLongPostIndexed(relativePath, content);
}

function chunkCommandOutput(
  relativePath: string,
  content: string,
  header: { commandId?: string; period?: string },
): RagTextChunk[] {
  const chunks: RagTextChunk[] = [];
  const baseMeta = {
    sourcePath: relativePath,
    commandId: header.commandId,
    period: header.period,
  };

  const summary = sectionSlice(content, "Summary", [
    "AILogs",
    "Tags",
    "Related",
  ]);
  if (summary) {
    chunks.push({
      text: summary,
      metadata: { ...baseMeta, chunkType: "command_summary" },
    });
  }

  const aiLogs = sectionSlice(content, "AILogs", ["Summary", "Tags", "Related"]);
  const aiBody = aiLogs || content;
  for (const line of aiBody.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const match = AILOG_LINE_PATTERN.exec(trimmed);
    if (!match) {
      continue;
    }
    const [, yyyy, mmm, dd, hh, mm, indexStr, rest] = match;
    chunks.push({
      text: trimmed,
      metadata: {
        ...baseMeta,
        chunkType: "command_ailog",
        noteId: `${yyyy}:${mmm}:${dd}:${hh}:${mm}:${indexStr}`,
        logicalDay: `${dd}_${mmm}_${yyyy}`,
        noteType: rest.includes(" ") ? rest.split(" ")[0] : undefined,
      },
    });
  }

  if (chunks.length === 0) {
    const trimmed = content.trim();
    if (trimmed) {
      chunks.push({
        text: trimmed,
        metadata: { ...baseMeta, chunkType: "command_summary" },
      });
    }
  }
  return chunks;
}

function chunkLongPostIndexed(
  relativePath: string,
  content: string,
): RagTextChunk[] {
  const chunks: RagTextChunk[] = [];
  const summary = sectionSlice(content, "Summary", [
    "Tags",
    "Related",
    "AILogs",
  ]);
  const tags = sectionSlice(content, "Tags", ["Related", "Summary", "AILogs"]);
  if (summary || tags) {
    const summaryText = [summary, tags].filter(Boolean).join("\n\n");
    chunks.push({
      text: summaryText,
      metadata: { chunkType: "indexed_summary", sourcePath: relativePath },
    });
  }

  const divider = content.indexOf("\n---\n");
  const body =
    divider >= 0
      ? content.slice(divider + 5).trim()
      : content.trim();
  if (body) {
    chunks.push({
      text: body,
      metadata: { chunkType: "indexed_body", sourcePath: relativePath },
    });
  }

  if (chunks.length === 0) {
    const trimmed = content.trim();
    if (trimmed) {
      chunks.push({
        text: trimmed,
        metadata: { chunkType: "indexed_body", sourcePath: relativePath },
      });
    }
  }
  return chunks;
}

function chunkPlainText(relativePath: string, content: string): RagTextChunk[] {
  const trimmed = content.trim();
  if (!trimmed) {
    return [];
  }
  const ext = relativePath.slice(relativePath.lastIndexOf(".")).toLowerCase();
  const chunkType: RagChunkType =
    ext === ".md" || ext === ".rst" ? "markdown" : "plain_text";
  return [
    {
      text: trimmed,
      metadata: { chunkType, sourcePath: relativePath },
    },
  ];
}

/**
 * Build text chunks with metadata for a repo-relative file (P6-T08).
 */
export function buildRagChunks(
  relativePath: string,
  content: string,
): RagTextChunk[] {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.includes("/daily/")) {
    const fileName = normalized.split("/").pop() ?? "";
    const day = parseDailyFileName(fileName);
    if (!day) {
      return [];
    }
    const chunks: RagTextChunk[] = [];
    for (const line of content.split("\n")) {
      const chunk = parseDailyLogLine(line, day, normalized);
      if (chunk) {
        chunks.push(chunk);
      }
    }
    return chunks;
  }

  if (normalized.includes("/indexed/")) {
    return chunkIndexedFile(normalized, content);
  }

  return chunkPlainText(normalized, content);
}
