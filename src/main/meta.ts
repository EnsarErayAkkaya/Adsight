import { META_API_VERSION } from "./config";
import type { ISODate } from "./dates";

export interface MetaDailyRow {
  date: ISODate;
  spend: number;
  impressions: number;
  clicks: number;
}

interface InsightsApiRow {
  date_start: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
}

interface InsightsApiResponse {
  data?: InsightsApiRow[];
  paging?: { next?: string };
  error?: { message: string; code: number };
}

const RETRYABLE_CODES = new Set([4, 17, 32, 613, 80000, 80004]); // Meta rate-limit family

async function fetchWithBackoff(url: string): Promise<InsightsApiResponse> {
  let delayMs = 2_000;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url);
    const body = (await res.json()) as InsightsApiResponse;
    if (!body.error && res.ok) return body;

    const code = body.error?.code ?? res.status;
    const retryable = res.status === 429 || RETRYABLE_CODES.has(code);
    if (!retryable || attempt >= 3) {
      throw new Error(
        `Meta Insights request failed (code ${code}): ${body.error?.message ?? res.statusText}`,
      );
    }
    await new Promise((r) => setTimeout(r, delayMs));
    delayMs *= 2;
  }
}

/**
 * Daily spend/impressions/clicks for one Meta campaign over [since, until],
 * one row per day (time_increment=1). Follows paging.
 */
export async function fetchMetaDailyInsights(
  metaCampaignId: string,
  since: ISODate,
  until: ISODate,
): Promise<MetaDailyRow[]> {
  if (process.env.META_FAKE === "1") {
    return fakeInsights(metaCampaignId, since, until);
  }

  const token = process.env.META_ACCESS_TOKEN;
  const account = process.env.META_AD_ACCOUNT_ID;
  if (!token || !account) {
    throw new Error(
      "META_ACCESS_TOKEN / META_AD_ACCOUNT_ID not configured (set META_FAKE=1 for fake dev data)",
    );
  }

  const params = new URLSearchParams({
    level: "campaign",
    fields: "spend,impressions,clicks",
    filtering: JSON.stringify([
      { field: "campaign.id", operator: "IN", value: [metaCampaignId] },
    ]),
    time_range: JSON.stringify({ since, until }),
    time_increment: "1",
    limit: "100",
    access_token: token,
  });

  let url: string | undefined =
    `https://graph.facebook.com/${META_API_VERSION}/act_${account}/insights?${params}`;

  const rows: MetaDailyRow[] = [];
  while (url) {
    const body = await fetchWithBackoff(url);
    for (const r of body.data ?? []) {
      rows.push({
        date: r.date_start,
        spend: Number(r.spend ?? 0),
        impressions: Number(r.impressions ?? 0),
        clicks: Number(r.clicks ?? 0),
      });
    }
    url = body.paging?.next;
  }
  return rows;
}

// --- Fake mode (META_FAKE=1): deterministic per campaign+date, so numbers
// stay stable across syncs and the pipeline can be exercised without creds.

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

function fakeInsights(
  metaCampaignId: string,
  since: ISODate,
  until: ISODate,
): MetaDailyRow[] {
  const rows: MetaDailyRow[] = [];
  const start = new Date(`${since}T00:00:00Z`);
  const end = new Date(`${until}T00:00:00Z`);
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10);
    const rand = seededRandom(`${metaCampaignId}:${date}`);
    const impressions = Math.round(10_000 + rand() * 20_000);
    rows.push({
      date,
      spend: Math.round((50 + rand() * 100) * 100) / 100,
      impressions,
      clicks: Math.round(impressions * (0.01 + rand() * 0.02)),
    });
  }
  return rows;
}
