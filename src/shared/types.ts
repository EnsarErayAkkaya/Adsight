/** Types shared between the main process, preload, and renderer. */

export type PlatformKind = "ios" | "android";

export const PLATFORM_LABELS: Record<PlatformKind, string> = {
  ios: "iOS",
  android: "Android",
};

export interface Game {
  id: string;
  name: string;
  ga4PropertyId: string;
  platforms: PlatformKind[];
  campaignCount: number;
}

export interface Campaign {
  id: string;
  platformId: string;
  name: string;
  metaCampaignId: string;
  startDate: string; // ISO "YYYY-MM-DD"
  endDate: string;
  /** ISO 3166-1 alpha-2 codes GA4 data is filtered to; empty = all countries. */
  countries: string[];
}

export interface PlatformDetail {
  id: string;
  platform: PlatformKind;
  campaigns: Campaign[];
}

export interface GameDetail {
  id: string;
  name: string;
  ga4PropertyId: string;
  platforms: PlatformDetail[];
}

export interface CreateGameInput {
  name: string;
  ga4PropertyId: string;
}

export interface CreatePlatformInput {
  gameId: string;
  platform: PlatformKind;
}

export interface CreateCampaignInput {
  platformId: string;
  name: string;
  metaCampaignId: string;
  startDate: string;
  endDate: string;
  countries: string[];
}

export interface UpdateCampaignInput {
  id: string;
  name: string;
  metaCampaignId: string;
  startDate: string;
  endDate: string;
  countries: string[];
}

/** One campaign of the connected Meta ad account (for the ID picker). */
export interface MetaCampaignOption {
  id: string;
  name: string;
  status: string;
}

export interface SettingsInfo {
  metaTokenConfigured: boolean;
  metaAdAccountId: string | null;
  ga4Configured: boolean;
  ga4ClientEmail: string | null;
  revenueMetric: string;
  /** False when the OS keychain is unavailable — secrets stored plaintext. */
  encryptionAvailable: boolean;
}

/** Only fields present with non-empty values are applied. */
export interface UpdateSettingsInput {
  metaAccessToken?: string;
  metaAdAccountId?: string;
  ga4ServiceAccountJson?: string;
  revenueMetric?: string;
}

/** How the renderer should format a column's numeric values. */
export type ColumnFormat = "money" | "int" | "pct" | "float1" | "minutes";

export interface ColumnDef {
  label: string;
  format: ColumnFormat;
}

/** A cell value: number, or null meaning "no data yet" (rendered as `—`). */
export type Cell = number | null;

export interface DayRow {
  date: string;
  completed: boolean;
  cells: Cell[];
}

/**
 * Global target bands, set once per platform (iOS/Android) and applied to
 * every game/campaign. Three boundary values split a column into four
 * colored zones (direction-aware): green / yellow / orange / red.
 */
export interface Band {
  low: number | null;
  mid: number | null;
  high: number | null;
}

/** Keyed by column label (e.g. "eCPI"). Missing/partial band = no coloring. */
export type TargetBands = Record<string, Band>;

/** The columns that support target bands, with their scoring direction. */
export const BAND_COLUMNS: {
  label: string;
  format: ColumnFormat;
  lowerIsBetter: boolean;
}[] = [
  { label: "CTR", format: "pct", lowerIsBetter: false },
  { label: "IPM", format: "float1", lowerIsBetter: false },
  { label: "CPI", format: "money", lowerIsBetter: true },
  { label: "eCPI", format: "money", lowerIsBetter: true },
  { label: "ROAS D0", format: "pct", lowerIsBetter: false },
  { label: "ROAS D7", format: "pct", lowerIsBetter: false },
  { label: "D1", format: "pct", lowerIsBetter: false },
  { label: "D7", format: "pct", lowerIsBetter: false },
];

/**
 * Built-in target bands used until the user saves their own for a column
 * (Settings). Boundaries are ascending (low ≤ mid ≤ high); direction comes
 * from BAND_COLUMNS.lowerIsBetter. iOS installs run pricier than Android,
 * hence the different CPI/eCPI/IPM levels.
 */
export const DEFAULT_TARGET_BANDS: Record<PlatformKind, TargetBands> = {
  ios: {
    CTR: { low: 0.01, mid: 0.02, high: 0.03 },
    IPM: { low: 5, mid: 10, high: 20 },
    CPI: { low: 1, mid: 2, high: 3 },
    eCPI: { low: 1, mid: 2, high: 3 },
    "ROAS D0": { low: 0.05, mid: 0.1, high: 0.2 },
    "ROAS D7": { low: 0.2, mid: 0.4, high: 0.6 },
    D1: { low: 0.25, mid: 0.35, high: 0.45 },
    D7: { low: 0.05, mid: 0.1, high: 0.15 },
  },
  android: {
    CTR: { low: 0.01, mid: 0.02, high: 0.03 },
    IPM: { low: 10, mid: 20, high: 35 },
    CPI: { low: 0.5, mid: 1, high: 1.5 },
    eCPI: { low: 0.5, mid: 1, high: 1.5 },
    "ROAS D0": { low: 0.05, mid: 0.1, high: 0.2 },
    "ROAS D7": { low: 0.2, mid: 0.4, high: 0.6 },
    D1: { low: 0.25, mid: 0.35, high: 0.45 },
    D7: { low: 0.05, mid: 0.1, high: 0.15 },
  },
};

/** One campaign in the global list, labeled for cross-game pickers. */
export interface CampaignListItem {
  id: string;
  name: string;
  gameName: string;
  platform: PlatformKind;
  startDate: string;
  endDate: string;
}

/** Per-source sync errors; null = that source synced fine. */
export interface SyncErrors {
  meta: string | null;
  ga4Installs: string | null;
  ga4Cohorts: string | null;
}

export interface SyncStatus {
  /** ISO datetime of the last fully-successful sync; null = never. */
  lastSyncedAt: string | null;
  errors: SyncErrors;
}

export interface CampaignTable {
  campaign: Campaign;
  gameName: string;
  gameId: string;
  platform: PlatformKind;
  columns: ColumnDef[];
  rows: DayRow[];
  /** Column averages ignoring `—` cells; null when a column has no values. */
  averages: Cell[];
  /** Freshness + per-source failures; failed sources show stored data only. */
  sync: SyncStatus;
  /** Global target bands for this campaign's platform (for cell coloring). */
  bands: TargetBands;
}

/** One level's funnel metrics (from GA4 level_start / level_end events). */
export interface LevelFunnelRow {
  /** The level_name event parameter (level index). */
  level: string;
  /** Unique users who fired level_start on this level. */
  players: number;
  /** level_start event count (attempts). */
  starts: number;
  /** level_end events with success=true; null when success isn't queryable. */
  wins: number | null;
  /** Unique users with a winning level_end; null when success isn't queryable. */
  completedUsers: number | null;
  /** completedUsers / players. */
  completionPct: number | null;
  /** 1 − players(next level) / players(this level); null on the last level. */
  churnPct: number | null;
  /** starts / wins. */
  attemptsPerWin: number | null;
  /** Needs a duration param on level_end (GA4 custom metric); null until sent. */
  avgWinDurationSec: number | null;
}

export interface LevelFunnel {
  scope: "campaign" | "game";
  gameId: string;
  gameName: string;
  /** Set when scope = "campaign". */
  campaignId?: string;
  campaignName?: string;
  platform?: PlatformKind;
  startDate: string;
  endDate: string;
  rows: LevelFunnelRow[];
  /**
   * True when the `success` event parameter isn't registered as a GA4
   * custom dimension yet — completion metrics render as "—".
   */
  successDimensionMissing: boolean;
}

export type LevelFunnelInput = { campaignId: string } | { gameId: string };

/** The API surface exposed to the renderer via contextBridge. */
export interface Api {
  games: {
    list(): Promise<Game[]>;
    create(input: CreateGameInput): Promise<void>;
    delete(id: string): Promise<void>;
    get(id: string): Promise<GameDetail | null>;
  };
  platforms: {
    create(input: CreatePlatformInput): Promise<void>;
    delete(id: string): Promise<void>;
  };
  campaigns: {
    create(input: CreateCampaignInput): Promise<void>;
    update(input: UpdateCampaignInput): Promise<void>;
    delete(id: string): Promise<void>;
    getTable(campaignId: string): Promise<CampaignTable | null>;
    listAll(): Promise<CampaignListItem[]>;
  };
  meta: {
    /** Campaigns of the connected ad account, for the ID picker. */
    listCampaigns(): Promise<MetaCampaignOption[]>;
  };
  analytics: {
    /**
     * Level funnel from GA4 level_start/level_end events — campaign-scoped
     * (platform + countries + date window) or game-scoped (all time).
     */
    levelFunnel(input: LevelFunnelInput): Promise<LevelFunnel | null>;
  };
  settings: {
    get(): Promise<SettingsInfo>;
    update(input: UpdateSettingsInput): Promise<void>;
  };
  targets: {
    /** Global bands per platform kind, applied to all games. */
    get(): Promise<Record<PlatformKind, TargetBands>>;
    set(platform: PlatformKind, bands: TargetBands): Promise<void>;
  };
}
