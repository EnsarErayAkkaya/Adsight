import { net } from "electron";
import type { MetaCampaignOption } from "@shared/types";
import { META_API_VERSION } from "./config";
import { describeFetchError } from "./ga4";
import type { ISODate } from "./dates";
import { getMetaCredentials } from "./settings";

export interface MetaDailyRow {
  date: ISODate;
  spend: number;
  impressions: number;
  clicks: number;
  /** Meta-attributed installs (`mobile_app_install` action). */
  installs: number;
}

interface InsightsApiRow {
  date_start: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: { action_type: string; value: string }[];
}

interface GraphApiResponse<Row> {
  data?: Row[];
  paging?: { next?: string };
  error?: { message: string; code: number };
}

type InsightsApiResponse = GraphApiResponse<InsightsApiRow>;

const RETRYABLE_CODES = new Set([4, 17, 32, 613, 80000, 80004]); // Meta rate-limit family

async function fetchWithBackoff<Row>(url: string): Promise<GraphApiResponse<Row>> {
  let delayMs = 2_000;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      // Chromium network stack — see the note in ga4.ts runReport.
      res = await net.fetch(url);
    } catch (err) {
      if (attempt >= 3) {
        throw new Error(
          `Meta API request could not be sent: ${describeFetchError(err)}`,
        );
      }
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs *= 2;
      continue;
    }
    const body = (await res.json()) as GraphApiResponse<Row>;
    if (!body.error && res.ok) return body;

    const code = body.error?.code ?? res.status;
    const retryable = res.status === 429 || RETRYABLE_CODES.has(code);
    if (!retryable || attempt >= 3) {
      throw new Error(
        `Meta API request failed (code ${code}): ${body.error?.message ?? res.statusText}`,
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

  const { token, account } = await getMetaCredentials();
  if (!token || !account) {
    throw new Error(
      "Meta credentials not configured — add them in Settings (or set META_FAKE=1 for fake dev data)",
    );
  }

  const params = new URLSearchParams({
    level: "campaign",
    fields: "spend,impressions,clicks,actions",
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
    const body: InsightsApiResponse = await fetchWithBackoff(url);
    for (const r of body.data ?? []) {
      rows.push({
        date: r.date_start,
        spend: Number(r.spend ?? 0),
        impressions: Number(r.impressions ?? 0),
        clicks: Number(r.clicks ?? 0),
        installs: Number(
          r.actions?.find((a) => a.action_type === "mobile_app_install")
            ?.value ?? 0,
        ),
      });
    }
    url = body.paging?.next;
  }
  return rows;
}

interface CampaignApiRow {
  id: string;
  name?: string;
  status?: string;
}

/** The ad account's campaigns, newest first — feeds the ID picker in the UI. */
export async function fetchMetaCampaigns(): Promise<MetaCampaignOption[]> {
  if (process.env.META_FAKE === "1") {
    return [
      { id: "120210000000000001", name: "Fake UA Campaign (iOS)", status: "ACTIVE" },
      { id: "120210000000000002", name: "Fake UA Campaign (Android)", status: "ACTIVE" },
      { id: "120210000000000003", name: "Fake Retargeting Test", status: "PAUSED" },
    ];
  }

  const { token, account } = await getMetaCredentials();
  if (!token || !account) {
    throw new Error("Meta credentials not configured — add them in Settings");
  }

  const params = new URLSearchParams({
    fields: "id,name,status",
    limit: "200",
    access_token: token,
  });
  let url: string | undefined =
    `https://graph.facebook.com/${META_API_VERSION}/act_${account}/campaigns?${params}`;

  const options: MetaCampaignOption[] = [];
  while (url) {
    const body: GraphApiResponse<CampaignApiRow> = await fetchWithBackoff(url);
    for (const c of body.data ?? []) {
      options.push({ id: c.id, name: c.name ?? c.id, status: c.status ?? "" });
    }
    url = body.paging?.next;
  }
  return options;
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
    const clicks = Math.round(impressions * (0.01 + rand() * 0.02));
    rows.push({
      date,
      spend: Math.round((50 + rand() * 100) * 100) / 100,
      impressions,
      clicks,
      installs: Math.round(clicks * (0.15 + rand() * 0.15)),
    });
  }
  return rows;
}
