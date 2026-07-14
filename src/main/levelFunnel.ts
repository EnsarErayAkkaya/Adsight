import type { LevelFunnel, LevelFunnelInput, LevelFunnelRow } from "@shared/types";
import { db } from "./db";
import { toISODate } from "./dates";
import { fetchGa4LevelFunnel, type Ga4LevelRaw } from "./ga4";
import { parseCountries } from "./sync";

/** GA4's earliest supported report date — used for the all-time game scope. */
const GA4_EPOCH = "2015-08-14";

/** Sort level names numerically when they parse as numbers ("2" < "10"). */
function levelOrder(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  return a.localeCompare(b, undefined, { numeric: true });
}

function buildRows(
  raw: Ga4LevelRaw[],
  successAvailable: boolean,
): LevelFunnelRow[] {
  const sorted = [...raw].sort((a, b) => levelOrder(a.level, b.level));
  return sorted.map((l, i) => {
    const next = sorted[i + 1];
    return {
      level: l.level,
      players: l.players,
      starts: l.starts,
      wins: successAvailable ? l.wins : null,
      completedUsers: successAvailable ? l.completedUsers : null,
      completionPct:
        successAvailable && l.players > 0 ? l.completedUsers / l.players : null,
      // Churn = players who started this level but never started the next.
      churnPct:
        next && l.players > 0
          ? Math.max(0, 1 - next.players / l.players)
          : null,
      attemptsPerWin:
        successAvailable && l.wins > 0 ? l.starts / l.wins : null,
      // Requires a duration parameter on level_end (GA4 custom metric).
      avgWinDurationSec: null,
    };
  });
}

/**
 * Campaign scope: the game's property + the campaign's platform, countries
 * and date window (same scoping as the daily table). Game scope: the whole
 * property, all platforms, all time. Queried live from GA4 — not stored.
 */
export async function getLevelFunnel(
  input: LevelFunnelInput,
): Promise<LevelFunnel | null> {
  const today = toISODate(new Date());

  if ("campaignId" in input) {
    const c = await db.query.campaign.findFirst({
      where: (campaign, { eq }) => eq(campaign.id, input.campaignId),
      with: { platform: { with: { game: true } } },
    });
    if (!c) return null;
    const endDate = c.endDate < today ? c.endDate : today;
    const result = await fetchGa4LevelFunnel(
      c.platform.game.ga4PropertyId,
      c.platform.platform,
      parseCountries(c.countries),
      c.startDate,
      endDate,
    );
    return {
      scope: "campaign",
      gameId: c.platform.game.id,
      gameName: c.platform.game.name,
      campaignId: c.id,
      campaignName: c.name,
      platform: c.platform.platform,
      startDate: c.startDate,
      endDate,
      rows: buildRows(result.rows, result.successAvailable),
      successDimensionMissing: !result.successAvailable,
    };
  }

  const g = await db.query.game.findFirst({
    where: (game, { eq }) => eq(game.id, input.gameId),
  });
  if (!g) return null;
  const result = await fetchGa4LevelFunnel(
    g.ga4PropertyId,
    null,
    [],
    GA4_EPOCH,
    today,
  );
  return {
    scope: "game",
    gameId: g.id,
    gameName: g.name,
    startDate: GA4_EPOCH,
    endDate: today,
    rows: buildRows(result.rows, result.successAvailable),
    successDimensionMissing: !result.successAvailable,
  };
}
