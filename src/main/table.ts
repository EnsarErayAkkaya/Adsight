import { eq } from "drizzle-orm";
import type { Cell, CampaignTable, ColumnDef, DayRow } from "@shared/types";
import { getTargetBands } from "./settings";
import { db } from "./db";
import { ga4Cohort, ga4Installs, metaDaily } from "./schema";
import { allDates, isDateCompleted } from "./dates";
import { parseCountries, syncCampaign } from "./sync";

const RETENTION_DAYS = [1, 2, 3, 4, 6, 7];
const PLAYTIME_DAYS = [0, 1, 2, 3];
const ROAS_DAYS = [0, 3, 7];

const COLUMNS: ColumnDef[] = [
  { label: "Spend", format: "money" },
  { label: "Impr.", format: "int" },
  { label: "Clicks", format: "int" },
  { label: "Installs", format: "int" },
  { label: "Sess/User", format: "float1" },
  { label: "CTR", format: "pct" },
  { label: "IPM", format: "float1" },
  { label: "CPI", format: "money" },
  { label: "eCPI", format: "money" },
  { label: "Revenue", format: "money" },
  ...ROAS_DAYS.map((n): ColumnDef => ({ label: `ROAS D${n}`, format: "pct" })),
  ...RETENTION_DAYS.map((n): ColumnDef => ({ label: `D${n}`, format: "pct" })),
  ...PLAYTIME_DAYS.map(
    (n): ColumnDef => ({ label: `PT D${n}`, format: "minutes" }),
  ),
];

interface DayData {
  meta?: {
    spend: number | null;
    impressions: number | null;
    clicks: number | null;
    /** Meta-attributed installs — feeds CPI (vs eCPI from GA4 installs). */
    installs: number | null;
  };
  installs?: number | null;
  sessionsPerUser?: number | null;
  cohort: Map<
    number,
    {
      activeUsers: number | null;
      totalUsers: number | null;
      avgPlaytimeSec: number | null;
      revenue: number | null;
    }
  >;
}

function buildRow(date: string, data: DayData | undefined): DayRow {
  const completed = isDateCompleted(date);
  const d = completed ? data : undefined;

  const spend = d?.meta?.spend ?? null;
  const impressions = d?.meta?.impressions ?? null;
  const clicks = d?.meta?.clicks ?? null;
  const metaInstalls = d?.meta?.installs ?? null;
  const installs = d?.installs ?? null;
  const sessionsPerUser = d?.sessionsPerUser ?? null;

  const ctr =
    clicks !== null && impressions !== null && impressions > 0
      ? clicks / impressions
      : null;
  const ipm =
    installs !== null && impressions !== null && impressions > 0
      ? (installs / impressions) * 1000
      : null;
  // CPI uses Meta's own attributed installs; eCPI uses GA4 installs.
  const cpi =
    spend !== null && metaInstalls !== null && metaInstalls > 0
      ? spend / metaInstalls
      : null;
  const ecpi =
    spend !== null && installs !== null && installs > 0
      ? spend / installs
      : null;

  // Cumulative cohort revenue so far: sum of all mature nth-day cells.
  const revenueCells = Array.from({ length: 8 }, (_, n) => {
    const r = d?.cohort.get(n)?.revenue;
    return typeof r === "number" ? r : null;
  });
  const knownRevenue = revenueCells.filter((r): r is number => r !== null);
  const revenue = knownRevenue.length
    ? knownRevenue.reduce((a, b) => a + b, 0)
    : null;

  // ROAS Dn = cumulative revenue through D+n ÷ spend; needs every cell 0..n.
  const roas = ROAS_DAYS.map((n): Cell => {
    if (spend === null || spend <= 0) return null;
    const upToN = revenueCells.slice(0, n + 1);
    if (upToN.some((r) => r === null)) return null;
    return (upToN as number[]).reduce((a, b) => a + b, 0) / spend;
  });

  const retention = RETENTION_DAYS.map((n): Cell => {
    const cell = d?.cohort.get(n);
    if (!cell || cell.activeUsers === null || !cell.totalUsers) return null;
    return cell.activeUsers / cell.totalUsers;
  });
  const playtime = PLAYTIME_DAYS.map(
    (n): Cell => d?.cohort.get(n)?.avgPlaytimeSec ?? null,
  );

  return {
    date,
    completed,
    cells: [
      spend, impressions, clicks, installs, sessionsPerUser, ctr, ipm, cpi, ecpi,
      revenue, ...roas, ...retention, ...playtime,
    ],
  };
}

/** Column averages that ignore `—` (null) cells entirely. */
function averages(rows: DayRow[]): Cell[] {
  return COLUMNS.map((_, i) => {
    const values = rows
      .map((r) => r.cells[i])
      .filter((v): v is number => v !== null);
    if (values.length === 0) return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
  });
}

/**
 * Sync the campaign (missing completed days / immature cohort cells), then
 * assemble the daily table from the DB. A failed sync degrades gracefully:
 * stored data is returned with `syncError` set.
 */
export async function getCampaignTable(
  campaignId: string,
): Promise<CampaignTable | null> {
  const c = await db.query.campaign.findFirst({
    where: (campaign, { eq }) => eq(campaign.id, campaignId),
    with: { platform: { with: { game: true } } },
  });
  if (!c) return null;

  const syncResult = await syncCampaign(c.id);

  const [metaRows, installRows, cohortRows] = await Promise.all([
    db.select().from(metaDaily).where(eq(metaDaily.campaignId, c.id)),
    db.select().from(ga4Installs).where(eq(ga4Installs.campaignId, c.id)),
    db.select().from(ga4Cohort).where(eq(ga4Cohort.campaignId, c.id)),
  ]);

  const byDay = new Map<string, DayData>();
  const day = (date: string): DayData => {
    if (!byDay.has(date)) byDay.set(date, { cohort: new Map() });
    return byDay.get(date)!;
  };
  for (const r of metaRows) day(r.date).meta = r;
  for (const r of installRows) {
    day(r.installDate).installs = r.installs;
    day(r.installDate).sessionsPerUser = r.sessionsPerUser;
  }
  for (const r of cohortRows) day(r.installDate).cohort.set(r.nthDay, r);

  const rows = allDates(c.startDate, c.endDate).map((d) =>
    buildRow(d, byDay.get(d)),
  );

  return {
    campaign: {
      id: c.id,
      platformId: c.platformId,
      name: c.name,
      metaCampaignId: c.metaCampaignId,
      startDate: c.startDate,
      endDate: c.endDate,
      countries: parseCountries(c.countries),
    },
    gameName: c.platform.game.name,
    gameId: c.platform.game.id,
    platform: c.platform.platform,
    columns: COLUMNS,
    rows,
    averages: averages(rows),
    sync: {
      lastSyncedAt: syncResult.lastSyncedAt,
      errors: syncResult.errors,
    },
    bands: await getTargetBands(c.platform.platform),
  };
}
