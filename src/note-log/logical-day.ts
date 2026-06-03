import { dailyNoteFileName } from "../paths/index.js";
import { getLocalParts, MONTH_ABBRS } from "./timezone.js";

const LOGICAL_DAY_OFFSET_MS = 6 * 60 * 60 * 1000;

export interface LogicalDay {
  dd: number;
  mmm: string;
  yyyy: number;
}

/**
 * Logical day runs 06:00 → 06:00 local time.
 * Label = local calendar date of (UTC instant − 6 hours) in the user's timezone.
 */
export function getLogicalDay(
  utcSeconds: number,
  timezone: string,
): LogicalDay {
  const shiftedMs = utcSeconds * 1000 - LOGICAL_DAY_OFFSET_MS;
  const { year, month, day } = getLocalParts(shiftedMs, timezone);
  return {
    dd: day,
    mmm: MONTH_ABBRS[month - 1] ?? "Jan",
    yyyy: year,
  };
}

export function logicalDayFileName(
  utcSeconds: number,
  timezone: string,
): string {
  return dailyNoteFileName(getLogicalDay(utcSeconds, timezone));
}
