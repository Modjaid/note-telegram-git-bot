/**
 * City and colloquial names → IANA timezone (setup dialog).
 * Keys are normalized via normalizeTimezoneAliasKey().
 */
const CITY_TIMEZONE_ALIASES: Record<string, string> = {
  // Russia & CIS
  moscow: "Europe/Moscow",
  moskva: "Europe/Moscow",
  москва: "Europe/Moscow",
  "saint petersburg": "Europe/Moscow",
  "st petersburg": "Europe/Moscow",
  spb: "Europe/Moscow",
  petersburg: "Europe/Moscow",
  минск: "Europe/Minsk",
  minsk: "Europe/Minsk",
  kyiv: "Europe/Kyiv",
  kiev: "Europe/Kyiv",
  алматы: "Asia/Almaty",
  almaty: "Asia/Almaty",
  astana: "Asia/Almaty",
  "yekaterinburg": "Asia/Yekaterinburg",
  ekaterinburg: "Asia/Yekaterinburg",
  novosibirsk: "Asia/Novosibirsk",
  vladivostok: "Asia/Vladivostok",
  kaliningrad: "Europe/Kaliningrad",
  samara: "Europe/Samara",
  irkutsk: "Asia/Irkutsk",
  красноярск: "Asia/Krasnoyarsk",
  krasnoyarsk: "Asia/Krasnoyarsk",
  // Common global cities
  berlin: "Europe/Berlin",
  london: "Europe/London",
  paris: "Europe/Paris",
  rome: "Europe/Rome",
  madrid: "Europe/Madrid",
  amsterdam: "Europe/Amsterdam",
  warsaw: "Europe/Warsaw",
  istanbul: "Europe/Istanbul",
  dubai: "Asia/Dubai",
  delhi: "Asia/Kolkata",
  mumbai: "Asia/Kolkata",
  bangkok: "Asia/Bangkok",
  singapore: "Asia/Singapore",
  "hong kong": "Asia/Hong_Kong",
  shanghai: "Asia/Shanghai",
  beijing: "Asia/Shanghai",
  tokyo: "Asia/Tokyo",
  seoul: "Asia/Seoul",
  sydney: "Australia/Sydney",
  melbourne: "Australia/Melbourne",
  "new york": "America/New_York",
  nyc: "America/New_York",
  chicago: "America/Chicago",
  denver: "America/Denver",
  "los angeles": "America/Los_Angeles",
  la: "America/Los_Angeles",
  vancouver: "America/Vancouver",
  toronto: "America/Toronto",
  "sao paulo": "America/Sao_Paulo",
  "mexico city": "America/Mexico_City",
  // Colloquial offsets (fixed-name zones)
  utc: "UTC",
  gmt: "UTC",
};

/** Normalize user text for alias lookup. */
export function normalizeTimezoneAliasKey(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:]+$/u, "")
    .replace(/\s+/gu, " ");
}

/** Resolve city/alias to IANA id, or null if unknown. */
export function resolveTimezoneAlias(text: string): string | null {
  const key = normalizeTimezoneAliasKey(text);
  if (!key) {
    return null;
  }
  return CITY_TIMEZONE_ALIASES[key] ?? null;
}
