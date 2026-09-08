export const SOLAR_TIME_ZONES = ["Europe/Amsterdam", "UTC", "browser"] as const;
export type SolarTimeZone = (typeof SOLAR_TIME_ZONES)[number];
export const DEFAULT_SOLAR_TIME_ZONE: SolarTimeZone = "Europe/Amsterdam";

export interface CivilTime {
  readonly date: string;
  readonly time: string;
  readonly minutes: number;
}
export type CivilConversion =
  | { readonly date: Date; readonly error?: undefined }
  | { readonly date: null; readonly error: string };

export function normalizeSolarTimeZone(value: unknown): SolarTimeZone {
  return typeof value === "string" &&
    (SOLAR_TIME_ZONES as readonly string[]).includes(value)
    ? (value as SolarTimeZone)
    : DEFAULT_SOLAR_TIME_ZONE;
}

function resolvedZone(zone: SolarTimeZone): string {
  return zone === "browser"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
    : zone;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: SolarTimeZone): Intl.DateTimeFormat {
  const actual = resolvedZone(zone);
  const cached = formatterCache.get(actual);
  if (cached) return cached;
  const next = new Intl.DateTimeFormat("en-CA", {
    timeZone: actual,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  formatterCache.set(actual, next);
  return next;
}

function parts(instant: Date, zone: SolarTimeZone): Record<string, string> {
  return Object.fromEntries(
    formatter(zone)
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function offsetAt(instant: Date, zone: SolarTimeZone): number {
  const local = parts(instant, zone);
  return (
    Date.UTC(
      Number(local.year),
      Number(local.month) - 1,
      Number(local.day),
      Number(local.hour),
      Number(local.minute),
    ) -
    instant.getTime() +
    instant.getUTCSeconds() * 1_000 +
    instant.getUTCMilliseconds()
  );
}

export function civilTimeFor(instant: Date, zone: SolarTimeZone): CivilTime {
  const values = parts(instant, normalizeSolarTimeZone(zone));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
    minutes: Number(values.hour) * 60 + Number(values.minute),
  };
}

export function zoneOffsetLabel(instant: Date, zone: SolarTimeZone): string {
  const normalized = normalizeSolarTimeZone(zone);
  const actual = resolvedZone(normalized);
  const get = (timeZoneName: "short" | "shortOffset") =>
    new Intl.DateTimeFormat("en-US", { timeZone: actual, timeZoneName })
      .formatToParts(instant)
      .find((part) => part.type === "timeZoneName")?.value;
  const name = get("short") ?? "UTC";
  const offset = (get("shortOffset") ?? "GMT").replace("GMT", "UTC");
  return `${normalized === "browser" ? actual : normalized} · ${name} (${offset})`;
}

export function civilToInstant(
  date: string,
  time: string,
  zone: SolarTimeZone,
): CivilConversion {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return { date: null, error: "Enter a valid date and time." };
  }
  const [hour = Number.NaN, minute = Number.NaN] = time.split(":").map(Number);
  if (hour > 23 || minute > 59)
    return { date: null, error: "Enter a valid date and time." };
  const naive = Date.parse(`${date}T${time}:00Z`);
  const parsed = new Date(naive);
  if (!Number.isFinite(naive) || parsed.toISOString().slice(0, 10) !== date) {
    return { date: null, error: "Enter a valid date and time." };
  }
  const target = `${date} ${time}`;
  const normalized = normalizeSolarTimeZone(zone);
  const offsets = new Set<number>();
  for (const hours of [-36, -12, 0, 12, 36]) {
    offsets.add(offsetAt(new Date(naive + hours * 60 * 60_000), normalized));
  }
  const candidates = [...offsets]
    .map((offset) => new Date(naive - offset))
    .filter((candidate) => {
      const civil = civilTimeFor(candidate, normalized);
      return `${civil.date} ${civil.time}` === target;
    })
    .sort((left, right) => left.getTime() - right.getTime());
  return candidates[0]
    ? { date: candidates[0] }
    : {
        date: null,
        error: "This time does not exist because clocks move forward.",
      };
}
