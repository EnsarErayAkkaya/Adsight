import { ipcMain } from "electron";
import { randomUUID } from "crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type {
  AdSummary,
  CampaignListItem,
  Game,
  GameDetail,
} from "@shared/types";
import { db } from "./db";
import {
  campaign,
  ga4Cohort,
  ga4Installs,
  game,
  metaAd,
  metaDaily,
  platform,
  PLATFORMS,
} from "./schema";
import { getCampaignTable } from "./table";
import { getLevelFunnel } from "./levelFunnel";
import { parseCountries } from "./sync";
import { fetchMetaCampaigns } from "./meta";
import { resetGa4Client } from "./ga4";
import {
  getSettingsInfo,
  getTargetBands,
  setTargetBands,
  updateSettings,
} from "./settings";

const settingsSchema = z.object({
  metaAccessToken: z.string().optional(),
  metaAdAccountId: z.string().optional(),
  ga4ServiceAccountJson: z.string().optional(),
  revenueMetric: z.string().optional(),
});

const bandsSchema = z.record(
  z.string(),
  z.object({
    low: z.number().nullable(),
    mid: z.number().nullable(),
    high: z.number().nullable(),
  }),
);

const gameSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  ga4PropertyId: z.string().trim().min(1, "GA4 property ID is required"),
});

const platformSchema = z.object({
  gameId: z.string().min(1),
  platform: z.enum(PLATFORMS),
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const campaignFields = {
  name: z.string().trim().min(1, "Name is required"),
  metaCampaignId: z.string().trim().min(1, "Meta campaign ID is required"),
  startDate: isoDate,
  endDate: isoDate,
  countries: z.array(
    z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, "Use 2-letter ISO codes like US, DE"),
  ),
};

const dateOrder = (c: { startDate: string; endDate: string }) =>
  c.startDate <= c.endDate;
const dateOrderMsg = { message: "End date must be on or after start date" };

const campaignSchema = z
  .object({ platformId: z.string().min(1), ...campaignFields })
  .refine(dateOrder, dateOrderMsg);

const campaignUpdateSchema = z
  .object({ id: z.string().min(1), ...campaignFields })
  .refine(dateOrder, dateOrderMsg);

export async function updateCampaign(parsed: {
  id: string;
  name: string;
  metaCampaignId: string;
  startDate: string;
  endDate: string;
  countries: string[];
}): Promise<void> {
  const existing = await db.query.campaign.findFirst({
    where: (campaign, { eq }) => eq(campaign.id, parsed.id),
  });
  if (!existing) throw new Error(`Campaign not found: ${parsed.id}`);

  const countriesJson = JSON.stringify(parsed.countries);
  await db
    .update(campaign)
    .set({
      name: parsed.name,
      metaCampaignId: parsed.metaCampaignId,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      countries: countriesJson,
    })
    .where(eq(campaign.id, parsed.id));

  // Stored spend belongs to the old Meta campaign — wipe so it re-fetches.
  if (existing.metaCampaignId !== parsed.metaCampaignId) {
    await db.delete(metaDaily).where(eq(metaDaily.campaignId, parsed.id));
  }

  // Stored GA4 data was fetched with the old country scope — wipe so the
  // next sync re-fetches installs and cohorts for the new countries.
  const oldCountries = JSON.stringify(parseCountries(existing.countries));
  if (oldCountries !== countriesJson) {
    await db.delete(ga4Installs).where(eq(ga4Installs.campaignId, parsed.id));
    await db.delete(ga4Cohort).where(eq(ga4Cohort.campaignId, parsed.id));
  }
}

export function registerIpcHandlers(): void {
  ipcMain.handle("games:list", async (): Promise<Game[]> => {
    const rows = await db.query.game.findMany({
      with: { platforms: { with: { campaigns: { columns: { id: true } } } } },
      orderBy: (game, { asc }) => [asc(game.name)],
    });

    // Lifetime aggregates per game from the stored daily rows (no API calls).
    const metaTotals = await db
      .select({
        gameId: platform.gameId,
        spend: sql<number | null>`sum(${metaDaily.spend})`,
        installs: sql<number | null>`sum(${metaDaily.installs})`,
      })
      .from(metaDaily)
      .innerJoin(campaign, eq(metaDaily.campaignId, campaign.id))
      .innerJoin(platform, eq(campaign.platformId, platform.id))
      .groupBy(platform.gameId);

    const ga4Totals = await db
      .select({
        gameId: platform.gameId,
        installs: sql<number | null>`sum(${ga4Installs.installs})`,
      })
      .from(ga4Installs)
      .innerJoin(campaign, eq(ga4Installs.campaignId, campaign.id))
      .innerJoin(platform, eq(campaign.platformId, platform.id))
      .groupBy(platform.gameId);

    const d1Totals = await db
      .select({
        gameId: platform.gameId,
        active: sql<number | null>`sum(${ga4Cohort.activeUsers})`,
        total: sql<number | null>`sum(${ga4Cohort.totalUsers})`,
      })
      .from(ga4Cohort)
      .innerJoin(campaign, eq(ga4Cohort.campaignId, campaign.id))
      .innerJoin(platform, eq(campaign.platformId, platform.id))
      .where(eq(ga4Cohort.nthDay, 1))
      .groupBy(platform.gameId);

    const metaBy = new Map(metaTotals.map((r) => [r.gameId, r]));
    const ga4By = new Map(ga4Totals.map((r) => [r.gameId, r]));
    const d1By = new Map(d1Totals.map((r) => [r.gameId, r]));
    const ratio = (num: number | null | undefined, den: number | null | undefined) =>
      num != null && den != null && den > 0 ? num / den : null;

    return rows.map((g): Game => {
      const meta = metaBy.get(g.id);
      const d1 = d1By.get(g.id);
      return {
        id: g.id,
        name: g.name,
        ga4PropertyId: g.ga4PropertyId,
        platforms: g.platforms.map((p) => p.platform),
        campaignCount: g.platforms.reduce((n, p) => n + p.campaigns.length, 0),
        archivedAt: g.archivedAt,
        stats: {
          totalSpend: meta?.spend ?? null,
          totalInstalls: ga4By.get(g.id)?.installs ?? null,
          avgCpi: ratio(meta?.spend, meta?.installs),
          avgD1: ratio(d1?.active, d1?.total),
        },
      };
    });
  });

  ipcMain.handle(
    "games:setArchived",
    async (_e, id: unknown, archived: unknown) => {
      await db
        .update(game)
        .set({
          archivedAt: z.boolean().parse(archived)
            ? new Date().toISOString()
            : null,
        })
        .where(eq(game.id, z.string().parse(id)));
    },
  );

  ipcMain.handle("games:create", async (_e, input: unknown) => {
    const parsed = gameSchema.parse(input);
    await db.insert(game).values({ id: randomUUID(), ...parsed });
  });

  ipcMain.handle("games:delete", async (_e, id: unknown) => {
    await db.delete(game).where(eq(game.id, z.string().parse(id)));
  });

  ipcMain.handle(
    "games:get",
    async (_e, id: unknown): Promise<GameDetail | null> => {
      const g = await db.query.game.findFirst({
        where: (game, { eq }) => eq(game.id, z.string().parse(id)),
        with: { platforms: { with: { campaigns: true } } },
      });
      if (!g) return null;
      return {
        id: g.id,
        name: g.name,
        ga4PropertyId: g.ga4PropertyId,
        platforms: [...g.platforms]
          .sort((a, b) => a.platform.localeCompare(b.platform))
          .map((p) => ({
            id: p.id,
            platform: p.platform,
            campaigns: [...p.campaigns]
              .sort((a, b) => b.startDate.localeCompare(a.startDate))
              .map((c) => ({ ...c, countries: parseCountries(c.countries) })),
          })),
      };
    },
  );

  ipcMain.handle("platforms:create", async (_e, input: unknown) => {
    const parsed = platformSchema.parse(input);
    const existing = await db.query.platform.findFirst({
      where: (platform, { and, eq }) =>
        and(
          eq(platform.gameId, parsed.gameId),
          eq(platform.platform, parsed.platform),
        ),
    });
    if (existing) {
      throw new Error(`This game already has an ${parsed.platform === "ios" ? "iOS" : "Android"} platform`);
    }
    await db.insert(platform).values({ id: randomUUID(), ...parsed });
  });

  ipcMain.handle("platforms:delete", async (_e, id: unknown) => {
    await db.delete(platform).where(eq(platform.id, z.string().parse(id)));
  });


  ipcMain.handle("campaigns:create", async (_e, input: unknown) => {
    const parsed = campaignSchema.parse(input);
    await db.insert(campaign).values({
      id: randomUUID(),
      ...parsed,
      countries: JSON.stringify(parsed.countries),
    });
  });

  ipcMain.handle("campaigns:update", async (_e, input: unknown) => {
    await updateCampaign(campaignUpdateSchema.parse(input));
  });

  ipcMain.handle("campaigns:delete", async (_e, id: unknown) => {
    await db.delete(campaign).where(eq(campaign.id, z.string().parse(id)));
  });

  ipcMain.handle("campaigns:table", async (_e, campaignId: unknown) => {
    return getCampaignTable(z.string().parse(campaignId));
  });

  ipcMain.handle("campaigns:listAll", async (): Promise<CampaignListItem[]> => {
    const rows = await db.query.campaign.findMany({
      with: { platform: { with: { game: true } } },
    });
    return rows
      .map((c) => ({
        id: c.id,
        name: c.name,
        gameName: c.platform.game.name,
        platform: c.platform.platform,
        startDate: c.startDate,
        endDate: c.endDate,
      }))
      .sort(
        (a, b) =>
          a.gameName.localeCompare(b.gameName) ||
          b.startDate.localeCompare(a.startDate),
      );
  });

  ipcMain.handle(
    "ads:forCampaign",
    async (_e, campaignId: unknown): Promise<AdSummary[]> => {
      const rows = await db
        .select()
        .from(metaAd)
        .where(eq(metaAd.campaignId, z.string().parse(campaignId)));
      return rows
        .map((r): AdSummary => {
          const ratio = (num: number | null, den: number | null) =>
            num !== null && den !== null && den > 0 ? num / den : null;
          return {
            adId: r.adId,
            name: r.name,
            spend: r.spend,
            impressions: r.impressions,
            clicks: r.clicks,
            installs: r.installs,
            cpi: ratio(r.spend, r.installs),
            ctr: ratio(r.clicks, r.impressions),
            ipm:
              ratio(r.installs, r.impressions) !== null
                ? ratio(r.installs, r.impressions)! * 1000
                : null,
            creativeType: r.creativeType,
            thumbnailUrl: r.thumbnailUrl,
            imageUrl: r.imageUrl,
            videoUrl: r.videoUrl,
            fetchedAt: r.fetchedAt,
          };
        })
        .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0));
    },
  );

  ipcMain.handle("targets:get", async () => {
    return {
      ios: await getTargetBands("ios"),
      android: await getTargetBands("android"),
    };
  });

  ipcMain.handle(
    "targets:set",
    async (_e, platformKind: unknown, bands: unknown) => {
      const kind = z.enum(PLATFORMS).parse(platformKind);
      await setTargetBands(kind, bandsSchema.parse(bands));
    },
  );

  ipcMain.handle("analytics:levelFunnel", async (_e, input: unknown) => {
    const parsed = z
      .union([
        z.object({ campaignId: z.string().min(1) }),
        z.object({ gameId: z.string().min(1) }),
      ])
      .parse(input);
    return getLevelFunnel(parsed);
  });

  ipcMain.handle("meta:campaigns", async () => {
    return fetchMetaCampaigns();
  });

  ipcMain.handle("settings:get", async () => {
    return getSettingsInfo();
  });

  ipcMain.handle("settings:update", async (_e, input: unknown) => {
    const parsed = settingsSchema.parse(input);
    await updateSettings(parsed);
    resetGa4Client(); // new credentials take effect immediately
  });
}
