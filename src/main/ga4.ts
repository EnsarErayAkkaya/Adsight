import { net } from "electron";
import { JWT } from "google-auth-library";
import { COHORT_MAX_NTH_DAY } from "./config";
import type { ISODate } from "./dates";
import { addDays } from "./dates";
import type { PlatformKind } from "./schema";
import { getGa4ServiceAccountJson, getRevenueMetric } from "./settings";

/** DB platform value → GA4 `platform` dimension value. */
const GA4_PLATFORM: Record<PlatformKind, string> = {
  ios: "iOS",
  android: "Android",
};

export interface Ga4InstallsRow {
  installDate: ISODate;
  installs: number;
  /** Sessions per user that day (all users in scope, not just the install cohort). */
  sessionsPerUser: number;
}

/** One cohort cell: install-day D at nth day n. */
export interface Ga4CohortCell {
  installDate: ISODate;
  nthDay: number;
  activeUsers: number;
  totalUsers: number;
  /** Average engagement seconds per active user on D+n. */
  avgPlaytimeSec: number;
  /** Purchase revenue from this cohort on D+n. */
  revenue: number;
}


// --- REST plumbing (GA4 Data API v1beta) ---

interface RunReportRow {
  dimensionValues?: { value?: string }[];
  metricValues?: { value?: string }[];
}

interface RunReportResponse {
  rows?: RunReportRow[];
  error?: { message?: string };
}

let _jwt: JWT | undefined;

/** Drops the cached auth client so new Settings credentials take effect. */
export function resetGa4Client(): void {
  _jwt = undefined;
}

async function getJwt(): Promise<JWT> {
  if (!_jwt) {
    const raw = await getGa4ServiceAccountJson();
    if (!raw) {
      throw new Error(
        "GA4 service account not configured — add it in Settings (or set GA4_FAKE=1 for fake dev data)",
      );
    }
    const creds = JSON.parse(raw) as { client_email: string; private_key: string };
    _jwt = new JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    });
  }
  return _jwt;
}

async function runReport(
  propertyId: string,
  body: object,
): Promise<RunReportResponse> {
  let token: string | null | undefined;
  try {
    ({ token } = await (await getJwt()).getAccessToken());
  } catch (err) {
    throw new Error(
      `GA4 auth token request failed: ${describeFetchError(err)}`,
    );
  }
  let res: Response;
  try {
    // Electron's net.fetch (Chromium network stack): more reliable in the
    // main process than Node's undici fetch and respects system proxy/VPN.
    res = await net.fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
  } catch (err) {
    throw new Error(`GA4 request could not be sent: ${describeFetchError(err)}`);
  }
  const json = (await res.json()) as RunReportResponse;
  if (!res.ok) {
    throw new Error(`GA4 runReport failed (${res.status}): ${json.error?.message}`);
  }
  return json;
}

/** Unwrap undici/Chromium "fetch failed" errors to their underlying cause. */
export function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause;
  if (cause instanceof Error) {
    const code = (cause as NodeJS.ErrnoException).code;
    return `${err.message} — ${cause.message}${code ? ` (${code})` : ""}`;
  }
  return err.message;
}

/**
 * Filter expressions shared by all reports: platform (null = all platforms,
 * for game-wide scope), plus target countries via the `countryId` dimension
 * (ISO alpha-2). An empty country list means worldwide — no country filter.
 */
function scopeExpressions(
  platform: PlatformKind | null,
  countries: string[],
): object[] {
  const expressions: object[] = [];
  if (platform) {
    expressions.push({
      filter: {
        fieldName: "platform",
        stringFilter: { value: GA4_PLATFORM[platform] },
      },
    });
  }
  if (countries.length > 0) {
    expressions.push({
      filter: {
        fieldName: "countryId",
        inListFilter: { values: countries },
      },
    });
  }
  return expressions;
}

// --- (a) Daily installs (first_open count) + daily sessions ---

export async function fetchGa4DailyInstalls(
  propertyId: string,
  platform: PlatformKind,
  countries: string[],
  startDate: ISODate,
  endDate: ISODate,
): Promise<Ga4InstallsRow[]> {
  if (process.env.GA4_FAKE === "1") {
    return fakeInstalls(propertyId, platform, countries, startDate, endDate);
  }

  const installsBody = {
    dimensions: [{ name: "date" }],
    metrics: [{ name: "eventCount" }],
    dateRanges: [{ startDate, endDate }],
    dimensionFilter: {
      andGroup: {
        expressions: [
          {
            filter: {
              fieldName: "eventName",
              stringFilter: { value: "first_open" },
            },
          },
          ...scopeExpressions(platform, countries),
        ],
      },
    },
    limit: 100_000,
  };
  // Sessions/user must be a separate report: the installs report is filtered
  // to first_open events, which would only count sessions with an install.
  const sessionsBody = {
    dimensions: [{ name: "date" }],
    metrics: [{ name: "sessionsPerUser" }],
    dateRanges: [{ startDate, endDate }],
    dimensionFilter: {
      andGroup: { expressions: scopeExpressions(platform, countries) },
    },
    limit: 100_000,
  };
  const [installsRes, sessionsRes] = await Promise.all([
    runReport(propertyId, installsBody),
    runReport(propertyId, sessionsBody),
  ]);

  const parseDate = (row: RunReportRow): ISODate => {
    const d = row.dimensionValues?.[0]?.value ?? ""; // "20260705"
    return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  };

  const byDate = new Map<ISODate, Ga4InstallsRow>();
  const day = (date: ISODate): Ga4InstallsRow => {
    if (!byDate.has(date)) {
      byDate.set(date, { installDate: date, installs: 0, sessionsPerUser: 0 });
    }
    return byDate.get(date)!;
  };
  for (const row of installsRes.rows ?? []) {
    day(parseDate(row)).installs = Number(row.metricValues?.[0]?.value ?? 0);
  }
  for (const row of sessionsRes.rows ?? []) {
    day(parseDate(row)).sessionsPerUser = Number(
      row.metricValues?.[0]?.value ?? 0,
    );
  }
  return [...byDate.values()];
}

// --- (b) Retention + playtime cohorts ---

/** GA4 allows a limited number of cohorts per request; stay well under it. */
const COHORTS_PER_REQUEST = 10;

/**
 * One cohort per install-day, nth days 0..7. Cohort names are set to the
 * install date so response rows map back trivially.
 */
export async function fetchGa4Cohorts(
  propertyId: string,
  platform: PlatformKind,
  countries: string[],
  installDates: ISODate[],
): Promise<Ga4CohortCell[]> {
  if (process.env.GA4_FAKE === "1") {
    return fakeCohorts(propertyId, platform, countries, installDates);
  }

  const cells: Ga4CohortCell[] = [];
  for (let i = 0; i < installDates.length; i += COHORTS_PER_REQUEST) {
    const chunk = installDates.slice(i, i + COHORTS_PER_REQUEST);
    const body = {
      dimensions: [{ name: "cohort" }, { name: "cohortNthDay" }],
      metrics: [
        { name: "cohortActiveUsers" },
        { name: "cohortTotalUsers" },
        { name: "userEngagementDuration" },
        { name: await getRevenueMetric() },
      ],
      dimensionFilter: {
        andGroup: { expressions: scopeExpressions(platform, countries) },
      },
      cohortSpec: {
        cohorts: chunk.map((d) => ({
          name: d,
          dimension: "firstSessionDate",
          dateRange: { startDate: d, endDate: d },
        })),
        cohortsRange: {
          granularity: "DAILY",
          startOffset: 0,
          endOffset: COHORT_MAX_NTH_DAY,
        },
      },
      limit: 100_000,
    };
    const res = await runReport(propertyId, body);

    for (const row of res.rows ?? []) {
      const installDate = row.dimensionValues?.[0]?.value ?? "";
      const nthDay = Number(row.dimensionValues?.[1]?.value ?? "0"); // "0000".."0007"
      const activeUsers = Number(row.metricValues?.[0]?.value ?? 0);
      const totalUsers = Number(row.metricValues?.[1]?.value ?? 0);
      const engagementSec = Number(row.metricValues?.[2]?.value ?? 0);
      const revenue = Number(row.metricValues?.[3]?.value ?? 0);
      cells.push({
        installDate,
        nthDay,
        activeUsers,
        totalUsers,
        avgPlaytimeSec: activeUsers > 0 ? engagementSec / activeUsers : 0,
        revenue,
      });
    }
  }
  return cells;
}

// --- (c) Level funnel: level_start / level_end events per level_name ---

/** Raw per-level counts; derived metrics are computed in levelFunnel.ts. */
export interface Ga4LevelRaw {
  level: string;
  starts: number;
  players: number;
  wins: number;
  completedUsers: number;
}

export interface Ga4LevelFunnelResult {
  rows: Ga4LevelRaw[];
  /**
   * False when the `success` event parameter isn't registered as a GA4
   * custom dimension — win/completion metrics are unknown in that case.
   */
  successAvailable: boolean;
}

/**
 * One report grouped by level_name × eventName × success. Requires the
 * `level_name` and `success` event parameters to be registered as
 * event-scoped custom dimensions on the GA4 property.
 */
export async function fetchGa4LevelFunnel(
  propertyId: string,
  platform: PlatformKind | null,
  countries: string[],
  startDate: ISODate,
  endDate: ISODate,
): Promise<Ga4LevelFunnelResult> {
  if (process.env.GA4_FAKE === "1") {
    return {
      rows: fakeLevelFunnel(propertyId, platform, countries),
      successAvailable: true,
    };
  }

  const buildBody = (withSuccess: boolean) => ({
    dimensions: [
      { name: "customEvent:level_name" },
      { name: "eventName" },
      ...(withSuccess ? [{ name: "customEvent:success" }] : []),
    ],
    metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
    dateRanges: [{ startDate, endDate }],
    dimensionFilter: {
      andGroup: {
        expressions: [
          {
            filter: {
              fieldName: "eventName",
              inListFilter: { values: ["level_start", "level_end"] },
            },
          },
          ...scopeExpressions(platform, countries),
        ],
      },
    },
    limit: 100_000,
  });

  // The `success` event parameter only becomes queryable once registered as
  // an event-scoped custom dimension. Until then, degrade to a start-only
  // funnel instead of failing the whole page.
  let successAvailable = true;
  let res: RunReportResponse;
  try {
    res = await runReport(propertyId, buildBody(true));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("customEvent:success")) throw err;
    successAvailable = false;
    res = await runReport(propertyId, buildBody(false));
  }

  const byLevel = new Map<string, Ga4LevelRaw>();
  const level = (name: string): Ga4LevelRaw => {
    if (!byLevel.has(name)) {
      byLevel.set(name, {
        level: name,
        starts: 0,
        players: 0,
        wins: 0,
        completedUsers: 0,
      });
    }
    return byLevel.get(name)!;
  };

  for (const row of res.rows ?? []) {
    const levelName = row.dimensionValues?.[0]?.value ?? "";
    const eventName = row.dimensionValues?.[1]?.value ?? "";
    const success = successAvailable
      ? (row.dimensionValues?.[2]?.value ?? "").toLowerCase()
      : "";
    const eventCount = Number(row.metricValues?.[0]?.value ?? 0);
    const totalUsers = Number(row.metricValues?.[1]?.value ?? 0);
    if (!levelName || levelName === "(not set)") continue;

    const l = level(levelName);
    if (eventName === "level_start") {
      l.starts += eventCount;
      l.players += totalUsers;
    } else if (eventName === "level_end" && (success === "true" || success === "1")) {
      l.wins += eventCount;
      l.completedUsers += totalUsers;
    }
  }
  return { rows: [...byLevel.values()], successAvailable };
}

// --- Fake mode (GA4_FAKE=1): deterministic per property+date ---

function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function fakeInstalls(
  propertyId: string,
  platform: PlatformKind,
  countries: string[],
  startDate: ISODate,
  endDate: ISODate,
): Ga4InstallsRow[] {
  const scope = countries.join(",") || "ALL";
  const rows: Ga4InstallsRow[] = [];
  for (let d = startDate; d <= endDate; d = addDays(d, 1)) {
    const rand = seededRandom(`${propertyId}:${platform}:${scope}:installs:${d}`);
    const installs = Math.round(200 + rand() * 400);
    rows.push({
      installDate: d,
      installs,
      sessionsPerUser: Math.round((1.5 + rand() * 2) * 10) / 10,
    });
  }
  return rows;
}

function fakeLevelFunnel(
  propertyId: string,
  platform: PlatformKind | null,
  countries: string[],
): Ga4LevelRaw[] {
  const scope = `${platform ?? "all"}:${countries.join(",") || "ALL"}`;
  const rows: Ga4LevelRaw[] = [];
  const rand = seededRandom(`${propertyId}:${scope}:levels`);
  let players = Math.round(3_000 + rand() * 5_000);
  for (let i = 1; i <= 30 && players > 5; i++) {
    const winRate = 0.55 + rand() * 0.35; // share of players who beat it
    const attemptsPerWin = 1 + rand() * (i / 8); // later levels take more tries
    const completedUsers = Math.round(players * winRate);
    const wins = Math.round(completedUsers * (1 + rand() * 0.1));
    rows.push({
      level: String(i),
      players,
      starts: Math.round(wins * attemptsPerWin + players * 0.2),
      wins,
      completedUsers,
    });
    players = Math.round(completedUsers * (0.85 + rand() * 0.12));
  }
  return rows;
}

function fakeCohorts(
  propertyId: string,
  platform: PlatformKind,
  countries: string[],
  installDates: ISODate[],
): Ga4CohortCell[] {
  const scope = countries.join(",") || "ALL";
  const cells: Ga4CohortCell[] = [];
  for (const d of installDates) {
    const rand = seededRandom(`${propertyId}:${platform}:${scope}:cohort:${d}`);
    const totalUsers = Math.round(200 + rand() * 400);
    const d1 = 0.3 + rand() * 0.15; // D1 retention 30–45%
    const decay = 0.75 + rand() * 0.1;
    const arppu = 2 + rand() * 6; // $ per paying user
    for (let n = 0; n <= COHORT_MAX_NTH_DAY; n++) {
      const retention = n === 0 ? 1 : d1 * Math.pow(decay, n - 1);
      const activeUsers = Math.round(totalUsers * retention);
      const playtime = (10 - n * 1.2 + rand() * 4) * 60; // ~5–14 min, fading
      const payerRate = 0.02 + rand() * 0.03; // 2–5% of actives purchase
      cells.push({
        installDate: d,
        nthDay: n,
        activeUsers,
        totalUsers,
        avgPlaytimeSec: Math.max(60, Math.round(playtime)),
        revenue: Math.round(activeUsers * payerRate * arppu * 100) / 100,
      });
    }
  }
  return cells;
}
