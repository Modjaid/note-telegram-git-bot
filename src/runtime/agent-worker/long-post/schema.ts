import { z } from "zod";

export const longPostOutputSchema = z.object({
  fileName: z
    .string()
    .describe(
      "Clear markdown filename for indexed storage, e.g. project_plan_q2.md",
    ),
  shortDescription: z
    .string()
    .describe(
      "Concise summary for the daily note line; may exceed 60 words for very large posts",
    ),
  tags: z
    .array(z.string())
    .describe("3-8 semantic topic tags without leading # characters"),
});

export type LongPostAgentOutput = z.infer<typeof longPostOutputSchema>;

export const LONG_POST_SYSTEM_INSTRUCTION = `You process long Telegram notes for a personal knowledge base.

Given the full message text, produce:
1. fileName — a short, descriptive markdown filename (letters, numbers, underscores; must end with .md).
2. shortDescription — a concise summary for a daily log line.
3. tags — 3-8 semantic topic tags (no # prefix).

Respond only with JSON matching the output schema.`;

export function buildLongPostUserPrompt(text: string): string {
  return `Analyze this long note and produce fileName, shortDescription, and tags.

--- NOTE START ---
${text.trim()}
--- NOTE END ---`;
}

export function parseLongPostOutput(raw: string): LongPostAgentOutput {
  const trimmed = raw.trim();
  const jsonText = extractJsonObject(trimmed);
  const parsed = JSON.parse(jsonText) as unknown;
  return longPostOutputSchema.parse(parsed);
}

function extractJsonObject(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    return fence[1].trim();
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return text.slice(start, end + 1);
  }
  return text;
}
