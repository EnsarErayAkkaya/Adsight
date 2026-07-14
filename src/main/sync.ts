import { eq } from "drizzle-orm";
import { db } from "./db";
import { campaign, ga4Cohort, ga4Installs, metaAd, metaDaily } from "./schema";
import type { Campaign, PlatformKind } from "./schema";
import { COHORT_MAX_NTH_DAY, META_RESTATEMENT_DAYS } from "./config";
import { completedDates, isCohortCellMature } from "./dates";
import { fetchGa4Cohorts, fetchGa4DailyInstalls } from "./ga4";
import { fetchMetaAds, fetchMetaDailyInsights } from "./meta";

/** Per-source error messages; null = that source synced fine. */
export interface SyncErrors {
  meta: string | null;
  metaAds: string | null;
  ga4Installs: string | null;
  ga4Cohorts: string | null;
}

export interface SyncResult {
  campaignId: string;
  completedDays: number;
  errors: SyncErrors;
  /** ISO datetime of the last fully-successful sync (this one, if clean). */
  lastSyncedAt: string | null;
}

async function getCampaign(campaignId: string) {
  const c = await db.query.campaign.findFirst({
    where: (campaign, { eq }) => eq(campaign.id, campaignId),
    with: { platform: { with: { game: true } } },
  });
  if (!c) throw new Error(`Campaign not found: ${campaignId}`);
  return c;
}

/**
 * GA4 scope for a campaign: the game's property + the platform dimension +
 * the campaign's target countries (empty = worldwide).
 */
interface Ga4Scope {
  propertyId: string;
  platform: PlatformKind;
  countries: string[];
}

/** Parse the campaign.countries JSON column; null/invalid = worldwide. */
export function parseCountries(json: string | null): string[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter((c) => typeof c === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Meta daily insights: fetch completed days missing from meta_daily, plus
 * the trailing META_RESTATEMENT_DAYS completed days even when stored —
 * Meta occasionally restates recent spend. Older stored days are final.
 */
async function syncMeta(c: Campaign, completed: string[]): Promise<void> {
  // Rows written before the installs column existed have installs=null;
  // treating them as absent makes them re-fetch (and backfill) once.
  const existing = new Set(
    (
      await db
        .select({ date: metaDaily.date, installs: metaDaily.installs })
        .from(metaDaily)
        .where(eq(metaDaily.campaignId, c.id))
    )
      .filter((r) => r.installs !== null)
      .map((r) => r.date),
  );
  const missing = completed.filter((d) => !existing.has(d));
  const restatement = completed.slice(-META_RESTATEMENT_DAYS);
  const toFetch = [...new Set([...missing, ...restatement])].sort();
  if (toFetch.length === 0) return;

  const rows = await fetchMetaDailyInsights(
    c.metaCampaignId,
    toFetch[0],
    toFetch[toFetch.length - 1],
  );
  const fetchSet = new Set(toFetch);
  const toUpsert = rows.filter((r) => fetchSet.has(r.date));

  for (const r of toUpsert) {
    await db
      .insert(metaDaily)
      .values({
        campaignId: c.id,
        date: r.date,
        spend: r.spend,
        impressions: r.impressions,
        clicks: r.clicks,
        installs: r.installs,
      })
      .onConflictDoUpdate({
        target: [metaDaily.campaignId, metaDaily.date],
        set: {
          spend: r.spend,
          impressions: r.impressions,
          clicks: r.clicks,
          installs: r.installs,
        },
      });
  }
}

/**
 * Per-ad totals + creatives: refreshed on every sync. Stats are lifetime
 * aggregates (not per-day facts) and creative URLs expire, so the table is
 * replaced wholesale — which also drops ads deleted on Meta's side.
 */
async function syncMetaAds(c: Campaign, completed: string[]): Promise<void> {
  if (completed.length === 0) return;
  const ads = await fetchMetaAds(
    c.metaCampaignId,
    completed[0],
    completed[completed.length - 1],
  );
  const fetchedAt = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx.delete(metaAd).where(eq(metaAd.campaignId, c.id));
    for (const a of ads) {
      await tx.insert(metaAd).values({
        campaignId: c.id,
        adId: a.adId,
        name: a.name,
        spend: a.spend,
        impressions: a.impressions,
        clicks: a.clicks,
        installs: a.installs,
        creativeType: a.creativeType,
        thumbnailUrl: a.thumbnailUrl,
        imageUrl: a.imageUrl,
        videoUrl: a.videoUrl,
        fetchedAt,
      });
    }
  });
}

/** GA4 installs: fetch completed install-days missing from ga4_installs. */
async function syncGa4Installs(
  c: Campaign,
  scope: Ga4Scope,
  completed: string[],
): Promise<void> {
  // Rows written before the sessions-per-user column existed have null there;
  // treating them as absent makes them re-fetch (and backfill) once.
  const existing = new Set(
    (
      await db
        .select({
          installDate: ga4Installs.installDate,
          sessionsPerUser: ga4Installs.sessionsPerUser,
        })
        .from(ga4Installs)
        .where(eq(ga4Installs.campaignId, c.id))
    )
      .filter((r) => r.sessionsPerUser !== null)
      .map((r) => r.installDate),
  );
  const missing = completed.filter((d) => !existing.has(d));
  if (missing.length === 0) return;

  const rows = await fetchGa4DailyInstalls(
    scope.propertyId,
    scope.platform,
    scope.countries,
    missing[0],
    missing[missing.length - 1],
  );
  const missingSet = new Set(missing);
  const toUpsert = rows.filter((r) => missingSet.has(r.installDate));

  for (const r of toUpsert) {
    await db
      .insert(ga4Installs)
      .values({
        campaignId: c.id,
        installDate: r.installDate,
        installs: r.installs,
        sessionsPerUser: r.sessionsPerUser,
      })
      .onConflictDoUpdate({
        target: [ga4Installs.campaignId, ga4Installs.installDate],
        set: { installs: r.installs, sessionsPerUser: r.sessionsPerUser },
      });
  }
}

/**
 * GA4 cohorts: an install-day D is "stale" while some nth-day cell (0..7)
 * is mature (D+n completed) but not stored. Stale days are re-fetched on
 * each sync until D7 lands; fully mature days are never re-fetched.
 * Only mature cells are stored, so a stored cell is always trustworthy.
 */
async function syncGa4Cohorts(
  c: Campaign,
  scope: Ga4Scope,
  completed: string[],
): Promise<void> {
  const storedCells = await db
    .select({
      installDate: ga4Cohort.installDate,
      nthDay: ga4Cohort.nthDay,
      revenue: ga4Cohort.revenue,
    })
    .from(ga4Cohort)
    .where(eq(ga4Cohort.campaignId, c.id));
  const storedByDay = new Map<string, Set<number>>();
  for (const cell of storedCells) {
    // Rows written before the revenue column existed have revenue=null;
    // treating them as absent makes them re-fetch (and backfill) once.
    if (cell.revenue === null) continue;
    if (!storedByDay.has(cell.installDate)) {
      storedByDay.set(cell.installDate, new Set());
    }
    storedByDay.get(cell.installDate)!.add(cell.nthDay);
  }

  const stale = completed.filter((d) => {
    const stored = storedByDay.get(d);
    for (let n = 0; n <= COHORT_MAX_NTH_DAY; n++) {
      if (isCohortCellMature(d, n) && !stored?.has(n)) return true;
    }
    return false;
  });
  if (stale.length === 0) return;

  const cells = await fetchGa4Cohorts(
    scope.propertyId,
    scope.platform,
    scope.countries,
    stale,
  );
  const staleSet = new Set(stale);

  for (const cell of cells) {
    if (!staleSet.has(cell.installDate)) continue;
    if (!isCohortCellMature(cell.installDate, cell.nthDay)) continue;
    await db
      .insert(ga4Cohort)
      .values({
        campaignId: c.id,
        installDate: cell.installDate,
        nthDay: cell.nthDay,
        activeUsers: cell.activeUsers,
        totalUsers: cell.totalUsers,
        avgPlaytimeSec: cell.avgPlaytimeSec,
        revenue: cell.revenue,
      })
      .onConflictDoUpdate({
        target: [ga4Cohort.campaignId, ga4Cohort.installDate, ga4Cohort.nthDay],
        set: {
          activeUsers: cell.activeUsers,
          totalUsers: cell.totalUsers,
          avgPlaytimeSec: cell.avgPlaytimeSec,
          revenue: cell.revenue,
        },
      });
  }
}

async function attempt(run: () => Promise<void>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * Full sync for one campaign: Meta daily + Meta ads + GA4 installs + GA4
 * cohorts. Each source fails independently; `last_synced_at` is stamped only
 * when all succeeded, so a stale indicator always means "distrust something".
 */
export async function syncCampaign(campaignId: string): Promise<SyncResult> {
  const c = await getCampaign(campaignId);
  const completed = completedDates(c.startDate, c.endDate);
  const scope: Ga4Scope = {
    propertyId: c.platform.game.ga4PropertyId,
    platform: c.platform.platform,
    countries: parseCountries(c.countries),
  };

  const errors: SyncErrors = {
    meta: await attempt(() => syncMeta(c, completed)),
    metaAds: await attempt(() => syncMetaAds(c, completed)),
    ga4Installs: await attempt(() => syncGa4Installs(c, scope, completed)),
    ga4Cohorts: await attempt(() => syncGa4Cohorts(c, scope, completed)),
  };

  let lastSyncedAt = c.lastSyncedAt;
  if (!errors.meta && !errors.metaAds && !errors.ga4Installs && !errors.ga4Cohorts) {
    lastSyncedAt = new Date().toISOString();
    await db
      .update(campaign)
      .set({ lastSyncedAt })
      .where(eq(campaign.id, c.id));
  }

  return {
    campaignId,
    completedDays: completed.length,
    errors,
    lastSyncedAt,
  };
}
