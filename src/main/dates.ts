import { COMPLETED_HOURS } from "./config";

/** ISO date string, e.g. "2026-07-13". All dates are handled as UTC calendar days. */
export type ISODate = string;

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** Parse an ISO date ("YYYY-MM-DD") to the UTC midnight starting that day. */
export function parseISODate(date: ISODate): Date {
  const d = new Date(`${date}T00:00:00.000Z`);
  if (isNaN(d.getTime())) throw new Error(`Invalid ISO date: ${date}`);
  return d;
}

/** Format a Date as an ISO date string (UTC calendar day). */
export function toISODate(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

/** Add n days to an ISO date. */
export function addDays(date: ISODate, n: number): ISODate {
  return toISODate(new Date(parseISODate(date).getTime() + n * MS_PER_DAY));
}

/**
 * A day D is completed once `now >= midnight(D+1) + COMPLETED_HOURS`.
 * Until then its metrics must render as `—`, never 0.
 */
export function isDateCompleted(date: ISODate, now: Date = new Date()): boolean {
  const endOfDay = parseISODate(date).getTime() + MS_PER_DAY;
  return now.getTime() >= endOfDay + COMPLETED_HOURS * MS_PER_HOUR;
}

/**
 * All completed dates within [start, end] inclusive, in ascending order.
 * Days inside the range that are not yet completed are excluded.
 */
export function completedDates(
  start: ISODate,
  end: ISODate,
  now: Date = new Date(),
): ISODate[] {
  const out: ISODate[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (isDateCompleted(d, now)) out.push(d);
  }
  return out;
}

/** Every date in [start, end] inclusive (completed or not) — one table row each. */
export function allDates(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * True once the cohort cell (install-day D, nth day n) can have real data:
 * the day D+n itself must be completed.
 */
export function isCohortCellMature(
  installDate: ISODate,
  nthDay: number,
  now: Date = new Date(),
): boolean {
  return isDateCompleted(addDays(installDate, nthDay), now);
}
