import { JWT } from "google-auth-library";
import { COHORT_MAX_NTH_DAY } from "./config";
import type { ISODate } from "./dates";
import { addDays } from "./dates";
import type { PlatformKind } from "./schema";

/** DB platform value → GA4 `platform` dimension value. */
const GA4_PLATFORM: Record<PlatformKind, string> = {
  ios: "iOS",
  android: "Android",
};

export interface Ga4InstallsRow {
  installDate: ISODate;
  installs: number;
}

/** One cohort cell: install-day D at nth day n. */
export interface Ga4CohortCell {
  installDate: ISODate;
  nthDay: number;
  activeUsers: number;
  totalUsers: number;
  /** Average engagement seconds per active user on D+n. */
  avgPlaytimeSec: number;
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

function getJwt(): JWT {
  if (!_jwt) {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!raw) {
      throw new Error(
        "GOOGLE_SERVICE_ACCOUNT_JSON not configured (set GA4_FAKE=1 for fake dev data)",
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
  const { token } = await getJwt().getAccessToken();
  const res = await fetch(
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
  const json = (await res.json()) as RunReportResponse;
  if (!res.ok) {
    throw new Error(`GA4 runReport failed (${res.status}): ${json.error?.message}`);
  }
  return json;
}

// --- (a) Daily installs: first_open count per day ---

export async function fetchGa4DailyInstalls(
  propertyId: string,
  platform: PlatformKind,
  startDate: ISODate,
  endDate: ISODate,
): Promise<Ga4InstallsRow[]> {
  if (process.env.GA4_FAKE === "1") {
    return fakeInstalls(propertyId, platform, startDate, endDate);
  }

  const body = {
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
          {
            filter: {
              fieldName: "platform",
              stringFilter: { value: GA4_PLATFORM[platform] },
            },
          },
        ],
      },
    },
    limit: 100_000,
  };
  const res = await runReport(propertyId, body);

  return (res.rows ?? []).map((row) => {
    const d = row.dimensionValues?.[0]?.value ?? ""; // "20260705"
    return {
      installDate: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
      installs: Number(row.metricValues?.[0]?.value ?? 0),
    };
  });
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
  installDates: ISODate[],
): Promise<Ga4CohortCell[]> {
  if (process.env.GA4_FAKE === "1") {
    return fakeCohorts(propertyId, platform, installDates);
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
      ],
      dimensionFilter: {
        filter: {
          fieldName: "platform",
          stringFilter: { value: GA4_PLATFORM[platform] },
        },
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
      cells.push({
        installDate,
        nthDay,
        activeUsers,
        totalUsers,
        avgPlaytimeSec: activeUsers > 0 ? engagementSec / activeUsers : 0,
      });
    }
  }
  return cells;
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
  startDate: ISODate,
  endDate: ISODate,
): Ga4InstallsRow[] {
  const rows: Ga4InstallsRow[] = [];
  for (let d = startDate; d <= endDate; d = addDays(d, 1)) {
    const rand = seededRandom(`${propertyId}:${platform}:installs:${d}`);
    rows.push({ installDate: d, installs: Math.round(200 + rand() * 400) });
  }
  return rows;
}

function fakeCohorts(
  propertyId: string,
  platform: PlatformKind,
  installDates: ISODate[],
): Ga4CohortCell[] {
  const cells: Ga4CohortCell[] = [];
  for (const d of installDates) {
    const rand = seededRandom(`${propertyId}:${platform}:cohort:${d}`);
    const totalUsers = Math.round(200 + rand() * 400);
    const d1 = 0.3 + rand() * 0.15; // D1 retention 30–45%
    const decay = 0.75 + rand() * 0.1;
    for (let n = 0; n <= COHORT_MAX_NTH_DAY; n++) {
      const retention = n === 0 ? 1 : d1 * Math.pow(decay, n - 1);
      const activeUsers = Math.round(totalUsers * retention);
      const playtime = (10 - n * 1.2 + rand() * 4) * 60; // ~5–14 min, fading
      cells.push({
        installDate: d,
        nthDay: n,
        activeUsers,
        totalUsers,
        avgPlaytimeSec: Math.max(60, Math.round(playtime)),
      });
    }
  }
  return cells;
}
