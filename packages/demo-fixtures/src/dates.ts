import { type LegacySeed, legacyInstants, legacySeed, legacySeedSchema } from "./source.js";

/** Time zone of the fictional organizations; date-only values are calendar days there. */
export const DEMO_TIME_ZONE = "America/Sao_Paulo";

const DAY = 86_400_000;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseYmd(value: string): [number, number, number] {
  const match = YMD.exec(value);
  if (!match) throw new Error(`Invalid calendar day: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Calendar day (YYYY-MM-DD) of an instant in the given time zone. */
export function calendarDay(at: Date, timeZone = DEMO_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Offset of the time zone at an instant, in minutes east of UTC. */
function offsetMinutes(at: number, timeZone: string): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((part) => part.type === "timeZoneName")?.value;
  if (name === undefined) throw new Error(`Cannot resolve the offset of ${timeZone}`);
  if (name === "GMT") return 0;
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name);
  if (!match) throw new Error(`Unexpected offset format for ${timeZone}: ${name}`);
  return (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
}

const pad = (value: number, size = 2) => String(Math.abs(value)).padStart(size, "0");

/**
 * ISO datetime with the zone offset for a date-only value: the first millisecond of the local
 * day (`start`) or its last one (`end`, used for due dates, end dates and milestones).
 */
export function localDay(ymd: string, timeZone = DEMO_TIME_ZONE, edge: "start" | "end" = "start"): string {
  const [y, m, d] = parseYmd(ymd);
  const [h, min, sec, ms]: [number, number, number, number] =
    edge === "start" ? [0, 0, 0, 0] : [23, 59, 59, 999];
  const wall = Date.UTC(y, m - 1, d, h, min, sec, ms);
  // the offset of the wall time itself, corrected once for a transition between guess and result
  let offset = offsetMinutes(wall, timeZone);
  offset = offsetMinutes(wall - offset * 60_000, timeZone);
  const sign = offset < 0 ? "-" : "+";
  const clock = `${pad(h)}:${pad(min)}:${pad(sec)}.${pad(ms, 3)}`;
  return `${ymd}T${clock}${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
}

function addDays(ymd: string, days: number): string {
  const [y, m, d] = parseYmd(ymd);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/**
 * Reproduces `createDemoData(now)` of apps/web/src/data/seed.ts in a fixed time zone:
 * date-only values move by the whole days between the seeding day and today; instants keep
 * their distance to `now`, minus the overhang of instants recorded after `seededAt`, so every
 * instant stays in the past and their order is preserved.
 */
export function shift(now: Date, timeZone = DEMO_TIME_ZONE): LegacySeed {
  const seededAt = Date.parse(legacySeed.meta.seededAt);
  const days = Math.round(
    (Date.parse(`${calendarDay(now, timeZone)}T00:00:00Z`) -
      Date.parse(`${calendarDay(new Date(seededAt), timeZone)}T00:00:00Z`)) /
      DAY,
  );
  const overhang = Math.max(0, ...legacyInstants.map((at) => at - seededAt));
  const elapsed = now.getTime() - seededAt - overhang - (overhang ? 60_000 : 0);
  const shiftValue = (value: unknown): unknown => {
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z)?$/.test(value)) {
      if (value.length === 10) return addDays(value, days);
      return new Date(Date.parse(value) + elapsed).toISOString();
    }
    if (Array.isArray(value)) return value.map(shiftValue);
    if (value !== null && typeof value === "object")
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shiftValue(item)]));
    return value;
  };
  const shifted = legacySeedSchema.parse(shiftValue(legacySeed));
  shifted.meta.seededAt = now.toISOString();
  return shifted;
}
