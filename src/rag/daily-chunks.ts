const LOG_LINE_PATTERN = /^(\d{2}):(\d{2}):(\d{2})\s+(.*)$/;

/**
 * Split a daily `<NoteLog>` file into one chunk per log entry (P6-T03).
 * Blank lines separate entries; each non-empty line is one chunk.
 */
export function chunkDailyFile(content: string): string[] {
  const chunks: string[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (LOG_LINE_PATTERN.test(trimmed)) {
      chunks.push(trimmed);
    }
  }
  return chunks;
}

/** Non-daily markdown: one chunk for the whole file body. */
export function chunkWholeFile(content: string): string[] {
  const trimmed = content.trim();
  return trimmed.length > 0 ? [trimmed] : [];
}
