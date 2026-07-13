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
}

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
    delete(id: string): Promise<void>;
    getTable(campaignId: string): Promise<CampaignTable | null>;
  };
}
