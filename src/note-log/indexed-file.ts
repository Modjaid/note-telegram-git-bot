export interface LongPostMetadata {
  fileName: string;
  shortDescription: string;
  tags: string[];
  wikilinks: string[];
  fullText: string;
}

/** Normalize agent-chosen filename to a safe `indexed/*.md` basename. */
export function sanitizeIndexedFileName(raw: string): string {
  let name = raw.trim().replace(/\\/g, "/");
  const slash = name.lastIndexOf("/");
  if (slash >= 0) {
    name = name.slice(slash + 1);
  }
  if (!name.toLowerCase().endsWith(".md")) {
    name = `${name}.md`;
  }
  const base = name.slice(0, -3);
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return `${slug || "long_post"}.md`;
}

export function formatIndexedMarkdown(meta: LongPostMetadata): string {
  const title = meta.fileName.replace(/\.md$/i, "").replace(/_/g, " ");
  const tagLine = meta.tags
    .map((tag) => {
      const cleaned = tag.trim().replace(/^#+/, "");
      return cleaned ? `#${cleaned.replace(/\s+/g, "_")}` : "";
    })
    .filter(Boolean)
    .join(" ");

  const related =
    meta.wikilinks.length > 0
      ? meta.wikilinks.map((link) => `[[${link}]]`).join(" ")
      : "";

  const sections = [
    `# ${title}`,
    "",
    "## Summary",
    meta.shortDescription.trim(),
    "",
  ];

  if (tagLine) {
    sections.push("## Tags", tagLine, "");
  }

  if (related) {
    sections.push("## Related", related, "");
  }

  sections.push("---", "", meta.fullText.trim(), "");
  return sections.join("\n");
}

export function buildLongPostDailyType(
  fileName: string,
  isForwarded: boolean,
  forwardFrom?: string,
): string {
  const longType = `Long ${fileName}`;
  if (!isForwarded) {
    return longType;
  }
  const nick = forwardFrom ? `@${forwardFrom}` : "@unknown";
  return `forwarded from ${nick} + ${longType}`;
}

export function formatLongPostFeedback(
  fileName: string,
  indexedRelativePath: string,
  dailyFileName: string,
  dailyLine: string,
  shortDescription: string,
): string {
  return [
    `Saved long post to indexed/${fileName}`,
    `(${indexedRelativePath})`,
    "",
    `Daily ${dailyFileName}:`,
    dailyLine,
    "",
    `Summary: ${shortDescription}`,
  ].join("\n");
}
