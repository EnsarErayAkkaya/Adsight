import type { Cell, ColumnFormat, TargetBands } from "@shared/types";
import { BAND_COLUMNS } from "@shared/types";

export const FORMATTERS: Record<ColumnFormat, (v: number) => string> = {
  money: (v) => `$${v.toFixed(2)}`,
  int: (v) => Math.round(v).toLocaleString("en-US"),
  pct: (v) => `${(v * 100).toFixed(1)}%`,
  float1: (v) => v.toFixed(1),
  minutes: (v) => `${(v / 60).toFixed(1)}m`,
};

export function formatCell(v: Cell, format: ColumnFormat): string {
  return v === null ? "—" : FORMATTERS[format](v);
}

/**
 * Band coloring (design decisions §5.2): soft background tint with the value
 * in a dark stop of the same hue — never gray-on-color, never saturated.
 * Worst → best. The `—` cell is never tinted.
 */
const ZONE_CLASSES = [
  "bg-red-600/10 text-red-700 dark:bg-red-400/15 dark:text-red-300",
  "bg-orange-500/10 text-orange-700 dark:bg-orange-400/15 dark:text-orange-300",
  "bg-yellow-500/15 text-yellow-700 dark:bg-yellow-400/15 dark:text-yellow-200",
  "bg-green-600/10 text-green-700 dark:bg-green-400/15 dark:text-green-300",
] as const;

const ZONE_NAMES = ["red", "orange", "yellow", "green"] as const;

/** 0..3 (worst → best), or null when the column has no complete band. */
export function bandZone(
  columnLabel: string,
  value: number,
  bands: TargetBands,
): number | null {
  const col = BAND_COLUMNS.find((c) => c.label === columnLabel);
  const band = bands[columnLabel];
  if (!col || !band) return null;
  const { low, mid, high } = band;
  if (low === null || mid === null || high === null) return null;

  if (col.lowerIsBetter) {
    let zone = 0;
    if (value <= high) zone = 1;
    if (value <= mid) zone = 2;
    if (value <= low) zone = 3;
    return zone;
  }
  let zone = 0;
  if (value >= low) zone = 1;
  if (value >= mid) zone = 2;
  if (value >= high) zone = 3;
  return zone;
}

/**
 * Tailwind classes tinting a cell against the platform's target bands.
 * low/mid/high split the range into four zones (red → orange → yellow →
 * green), mirrored for lower-is-better columns like CPI/eCPI.
 */
export function bandClass(
  columnLabel: string,
  value: Cell,
  bands: TargetBands,
): string {
  if (value === null) return "";
  const zone = bandZone(columnLabel, value, bands);
  return zone === null ? "" : ZONE_CLASSES[zone];
}

/** Hover text explaining which band a value fell into (§12). */
export function bandTitle(
  columnLabel: string,
  value: Cell,
  bands: TargetBands,
  format: ColumnFormat,
): string | undefined {
  if (value === null) return undefined;
  const zone = bandZone(columnLabel, value, bands);
  const band = bands[columnLabel];
  if (zone === null || !band) return undefined;
  const f = FORMATTERS[format];
  const col = BAND_COLUMNS.find((c) => c.label === columnLabel);
  return `${ZONE_NAMES[zone]} · bands ${f(band.low!)} / ${f(band.mid!)} / ${f(
    band.high!,
  )}${col?.lowerIsBetter ? " (lower is better)" : ""}`;
}
