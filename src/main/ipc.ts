import { ipcMain } from "electron";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Game, GameDetail } from "@shared/types";
import { db } from "./db";
import { campaign, game, platform, PLATFORMS } from "./schema";
import { getCampaignTable } from "./table";

const gameSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  ga4PropertyId: z.string().trim().min(1, "GA4 property ID is required"),
});

const platformSchema = z.object({
  gameId: z.string().min(1),
  platform: z.enum(PLATFORMS),
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const campaignSchema = z
  .object({
    platformId: z.string().min(1),
    name: z.string().trim().min(1, "Name is required"),
    metaCampaignId: z.string().trim().min(1, "Meta campaign ID is required"),
    startDate: isoDate,
    endDate: isoDate,
  })
  .refine((c) => c.startDate <= c.endDate, {
    message: "End date must be on or after start date",
  });

export function registerIpcHandlers(): void {
  ipcMain.handle("games:list", async (): Promise<Game[]> => {
    const rows = await db.query.game.findMany({
      with: { platforms: { with: { campaigns: { columns: { id: true } } } } },
      orderBy: (game, { asc }) => [asc(game.name)],
    });
    return rows.map((g) => ({
      id: g.id,
      name: g.name,
      ga4PropertyId: g.ga4PropertyId,
      platforms: g.platforms.map((p) => p.platform),
      campaignCount: g.platforms.reduce((n, p) => n + p.campaigns.length, 0),
    }));
  });

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
            campaigns: [...p.campaigns].sort((a, b) =>
              b.startDate.localeCompare(a.startDate),
            ),
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
    await db.insert(campaign).values({ id: randomUUID(), ...parsed });
  });

  ipcMain.handle("campaigns:delete", async (_e, id: unknown) => {
    await db.delete(campaign).where(eq(campaign.id, z.string().parse(id)));
  });

  ipcMain.handle("campaigns:table", async (_e, campaignId: unknown) => {
    return getCampaignTable(z.string().parse(campaignId));
  });
}
