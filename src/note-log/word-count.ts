/** Spec threshold: messages with more than 60 words use the long-post pipeline. */
export const LONG_POST_WORD_THRESHOLD = 60;

/** Count words in plain text (whitespace-separated tokens). */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return trimmed.split(/\s+/u).length;
}

export function isLongPost(text: string): boolean {
  return countWords(text) > LONG_POST_WORD_THRESHOLD;
}
