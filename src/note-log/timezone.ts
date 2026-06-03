import { resolveTimezoneAlias } from "./timezone-aliases.js";

/** English short month labels for daily filenames (DD_MMM_YYYY). */
export const MONTH_ABBRS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const LOCAL_PARTS_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function localPartsFormatter(timezone: string): Intl.DateTimeFormat {
  let formatter = LOCAL_PARTS_FORMATTER_CACHE.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    LOCAL_PARTS_FORMATTER_CACHE.set(timezone, formatter);
  }
  return formatter;
}

export interface LocalDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** True when `timezone` is a valid IANA time zone name. */
export function isValidTimezone(timezone: string): boolean {
  const trimmed = timezone.trim();
  if (!trimmed) {
    return false;
  }
  try {
    localPartsFormatter(trimmed).formatToParts(new Date());
    return true;
  } catch {
    return false;
  }
}

/** Calendar and clock components for an instant in the user's timezone. */
export function getLocalParts(
  utcMs: number,
  timezone: string,
): LocalDateTimeParts {
  const parts = localPartsFormatter(timezone).formatToParts(new Date(utcMs));
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number.parseInt(lookup.year ?? "0", 10),
    month: Number.parseInt(lookup.month ?? "0", 10),
    day: Number.parseInt(lookup.day ?? "0", 10),
    hour: Number.parseInt(lookup.hour ?? "0", 10),
    minute: Number.parseInt(lookup.minute ?? "0", 10),
  };
}

/** HH and mm strings for a `<NoteLog>` line header (bot receive time, local). */
export function formatLocalClock(
  utcSeconds: number,
  timezone: string,
): { hh: string; mm: string } {
  const { hour, minute } = getLocalParts(utcSeconds * 1000, timezone);
  return {
    hh: String(hour).padStart(2, "0"),
    mm: String(minute).padStart(2, "0"),
  };
}

/**
 * Normalize user input to a validated IANA timezone, or null when invalid.
 * Accepts IANA names (Europe/Moscow) or city aliases (moscow, Berlin).
 */
export function parseTimezoneInput(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith("/")) {
    return null;
  }

  const fromAlias = resolveTimezoneAlias(trimmed);
  if (fromAlias && isValidTimezone(fromAlias)) {
    return fromAlias;
  }

  return isValidTimezone(trimmed) ? trimmed : null;
}
