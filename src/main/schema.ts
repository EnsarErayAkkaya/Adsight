import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

// Dates are stored as ISO "YYYY-MM-DD" text — sorts and compares correctly.

export const PLATFORMS = ["ios", "android"] as const;
export type PlatformKind = (typeof PLATFORMS)[number];

export const game = sqliteTable("game", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ga4PropertyId: text("ga4_property_id").notNull(),
});

/** A game's presence on one store platform; at most one row per platform. */
export const platform = sqliteTable(
  "platform",
  {
    id: text("id").primaryKey(),
    gameId: text("game_id")
      .notNull()
      .references(() => game.id, { onDelete: "cascade" }),
    platform: text("platform", { enum: PLATFORMS }).notNull(),
  },
  (t) => [uniqueIndex("platform_game_unique").on(t.gameId, t.platform)],
);

export const campaign = sqliteTable("campaign", {
  id: text("id").primaryKey(),
  platformId: text("platform_id")
    .notNull()
    .references(() => platform.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  metaCampaignId: text("meta_campaign_id").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  /**
   * JSON array of ISO 3166-1 alpha-2 codes the campaign targets (e.g.
   * ["US","CA"]). GA4 data is filtered to these; null/empty = all countries.
   */
  countries: text("countries"),
  /** ISO datetime of the last fully-successful sync; null = never synced. */
  lastSyncedAt: text("last_synced_at"),
});
// Note: no per-campaign GA4 field needed. One campaign per platform at a
// time, so GA4 is filtered by the game's property + the platform dimension
// + the campaign date window.

/** Meta traffic/spend, one row per campaign per day. */
export const metaDaily = sqliteTable(
  "meta_daily",
  {
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaign.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    spend: real("spend"),
    impressions: integer("impressions"),
    clicks: integer("clicks"),
    /** Meta-attributed installs (`mobile_app_install` action) — feeds CPI. */
    installs: integer("installs"),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.date] })],
);

/**
 * Per-ad lifetime totals + creative preview for the campaign's Ads section.
 * Replaced wholesale on each successful ads sync (stats are aggregates, not
 * daily facts). Creative URLs are signed Meta CDN links that expire after a
 * few days — `fetchedAt` says how fresh they are; a sync refreshes them.
 */
export const metaAd = sqliteTable(
  "meta_ad",
  {
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaign.id, { onDelete: "cascade" }),
    adId: text("ad_id").notNull(),
    name: text("name").notNull(),
    spend: real("spend"),
    impressions: integer("impressions"),
    clicks: integer("clicks"),
    /** Meta-attributed installs (`mobile_app_install` action). */
    installs: integer("installs"),
    creativeType: text("creative_type", {
      enum: ["image", "video", "unknown"],
    }).notNull(),
    thumbnailUrl: text("thumbnail_url"),
    imageUrl: text("image_url"),
    videoUrl: text("video_url"),
    fetchedAt: text("fetched_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.adId] })],
);

/** GA4 installs (first_open), one row per campaign per install-day. */
export const ga4Installs = sqliteTable(
  "ga4_installs",
  {
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaign.id, { onDelete: "cascade" }),
    installDate: text("install_date").notNull(),
    installs: integer("installs"),
    /** GA4 sessions per user that day (all users, same platform/country scope). */
    sessionsPerUser: real("sessions_per_user"),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.installDate] })],
);

/** GA4 cohort cells: retention + playtime by install-day and nth day (0..7). */
export const ga4Cohort = sqliteTable(
  "ga4_cohort",
  {
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaign.id, { onDelete: "cascade" }),
    installDate: text("install_date").notNull(),
    nthDay: integer("nth_day").notNull(),
    activeUsers: integer("active_users"),
    totalUsers: integer("total_users"),
    avgPlaytimeSec: real("avg_playtime_sec"),
    /** Purchase revenue from this cohort on D+n. Null = not fetched yet. */
    revenue: real("revenue"),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.installDate, t.nthDay] })],
);

/**
 * App settings (credentials etc.) as key/value. Secret values are encrypted
 * with Electron safeStorage and prefixed "enc:"; plaintext uses "plain:".
 */
export const setting = sqliteTable("setting", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const gameRelations = relations(game, ({ many }) => ({
  platforms: many(platform),
}));

export const platformRelations = relations(platform, ({ one, many }) => ({
  game: one(game, { fields: [platform.gameId], references: [game.id] }),
  campaigns: many(campaign),
}));

export const campaignRelations = relations(campaign, ({ one }) => ({
  platform: one(platform, {
    fields: [campaign.platformId],
    references: [platform.id],
  }),
}));

export type Game = typeof game.$inferSelect;
export type Platform = typeof platform.$inferSelect;
export type Campaign = typeof campaign.$inferSelect;
export type MetaDaily = typeof metaDaily.$inferSelect;
export type MetaAd = typeof metaAd.$inferSelect;
export type Ga4Installs = typeof ga4Installs.$inferSelect;
export type Ga4Cohort = typeof ga4Cohort.$inferSelect;
