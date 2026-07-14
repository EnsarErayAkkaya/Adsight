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

/**
 * GET a Graph API URL with retry/backoff on rate limits. `Body` is the raw
 * response shape — a `{ data, paging }` list for most endpoints, or a map
 * keyed by object id for `?ids=` batch reads.
 */
async function fetchWithBackoff<
  Body extends { error?: { message: string; code: number } },
>(url: string): Promise<Body> {
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
    const body = (await res.json()) as Body;
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

export interface MetaAdData {
  adId: string;
  name: string;
  /** Lifetime totals over the campaign's date range. */
  spend: number;
  impressions: number;
  clicks: number;
  /** Meta-attributed installs (`mobile_app_install` action). */
  installs: number;
  creativeType: "image" | "video" | "unknown";
  thumbnailUrl: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
}

interface AdInsightsApiRow {
  ad_id: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: { action_type: string; value: string }[];
}

interface AdCreativeApiRow {
  creative?: {
    thumbnail_url?: string;
    image_url?: string;
    video_id?: string;
  };
  error?: { message: string; code: number };
}

/** `?ids=` batch reads return a map keyed by object id instead of `{ data }`. */
type BatchApiResponse<Item> = Record<string, Item> & {
  error?: { message: string; code: number };
};

const CREATIVE_BATCH_SIZE = 50;

/**
 * Per-ad lifetime totals over [since, until] plus creative previews, for the
 * campaign page's Ads section. One insights call (level=ad, no
 * time_increment → aggregated), then batched creative + video-source reads.
 */
export async function fetchMetaAds(
  metaCampaignId: string,
  since: ISODate,
  until: ISODate,
): Promise<MetaAdData[]> {
  if (process.env.META_FAKE === "1") {
    return fakeAds(metaCampaignId);
  }

  const { token, account } = await getMetaCredentials();
  if (!token || !account) {
    throw new Error(
      "Meta credentials not configured — add them in Settings (or set META_FAKE=1 for fake dev data)",
    );
  }

  const params = new URLSearchParams({
    level: "ad",
    fields: "ad_id,ad_name,spend,impressions,clicks,actions",
    filtering: JSON.stringify([
      { field: "campaign.id", operator: "IN", value: [metaCampaignId] },
    ]),
    time_range: JSON.stringify({ since, until }),
    limit: "100",
    access_token: token,
  });
  let url: string | undefined =
    `https://graph.facebook.com/${META_API_VERSION}/act_${account}/insights?${params}`;

  const ads: MetaAdData[] = [];
  while (url) {
    const body: GraphApiResponse<AdInsightsApiRow> = await fetchWithBackoff(url);
    for (const r of body.data ?? []) {
      ads.push({
        adId: r.ad_id,
        name: r.ad_name ?? r.ad_id,
        spend: Number(r.spend ?? 0),
        impressions: Number(r.impressions ?? 0),
        clicks: Number(r.clicks ?? 0),
        installs: Number(
          r.actions?.find((a) => a.action_type === "mobile_app_install")
            ?.value ?? 0,
        ),
        creativeType: "unknown",
        thumbnailUrl: null,
        imageUrl: null,
        videoUrl: null,
      });
    }
    url = body.paging?.next;
  }
  if (ads.length === 0) return ads;

  await attachCreatives(ads, token);
  return ads;
}

/** Fill creativeType/thumbnail/image/video on the fetched ads, in place. */
async function attachCreatives(ads: MetaAdData[], token: string): Promise<void> {
  const byId = new Map(ads.map((a) => [a.adId, a]));
  const videoIdByAd = new Map<string, string>();

  for (let i = 0; i < ads.length; i += CREATIVE_BATCH_SIZE) {
    const batch = ads.slice(i, i + CREATIVE_BATCH_SIZE);
    const params = new URLSearchParams({
      ids: batch.map((a) => a.adId).join(","),
      // Field modifiers: the default thumbnail is 64×64 — ask for a card-sized one.
      fields:
        "creative.thumbnail_width(512).thumbnail_height(512){thumbnail_url,image_url,video_id}",
      access_token: token,
    });
    const body: BatchApiResponse<AdCreativeApiRow> = await fetchWithBackoff(
      `https://graph.facebook.com/${META_API_VERSION}/?${params}`,
    );
    for (const [adId, row] of Object.entries(body)) {
      const ad = byId.get(adId);
      const creative = (row as AdCreativeApiRow).creative;
      if (!ad || !creative) continue;
      ad.thumbnailUrl = creative.thumbnail_url ?? null;
      ad.imageUrl = creative.image_url ?? null;
      if (creative.video_id) {
        ad.creativeType = "video";
        videoIdByAd.set(adId, creative.video_id);
      } else if (creative.image_url) {
        ad.creativeType = "image";
      }
    }
  }

  // Playable mp4 URLs. Best-effort: `source` needs the token to own the
  // video; on failure the card falls back to the thumbnail.
  const videoIds = [...new Set(videoIdByAd.values())];
  const sourceByVideo = new Map<string, string>();
  try {
    for (let i = 0; i < videoIds.length; i += CREATIVE_BATCH_SIZE) {
      const params = new URLSearchParams({
        ids: videoIds.slice(i, i + CREATIVE_BATCH_SIZE).join(","),
        fields: "source",
        access_token: token,
      });
      const body: BatchApiResponse<{ source?: string }> =
        await fetchWithBackoff(
          `https://graph.facebook.com/${META_API_VERSION}/?${params}`,
        );
      for (const [videoId, row] of Object.entries(body)) {
        const source = (row as { source?: string }).source;
        if (source) sourceByVideo.set(videoId, source);
      }
    }
  } catch {
    // Videos render as thumbnails only.
  }
  for (const [adId, videoId] of videoIdByAd) {
    byId.get(adId)!.videoUrl = sourceByVideo.get(videoId) ?? null;
  }
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

/** Deterministic fake ads with SVG placeholder visuals (no network needed). */
function fakeAds(metaCampaignId: string): MetaAdData[] {
  const names = [
    "Gameplay 30s v2",
    "UGC hook — 'I can't stop'",
    "Level fail compilation",
    "Static — character lineup",
    "Playable teaser cutdown",
  ];
  return names.map((name, i) => {
    const rand = seededRandom(`${metaCampaignId}:ad:${i}`);
    const impressions = Math.round(50_000 + rand() * 400_000);
    const clicks = Math.round(impressions * (0.008 + rand() * 0.03));
    const isVideo = i % 3 !== 2;
    const hue = Math.round(rand() * 360);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">` +
      `<rect width="512" height="512" fill="hsl(${hue},45%,40%)"/>` +
      (isVideo
        ? `<circle cx="256" cy="256" r="64" fill="rgba(255,255,255,.85)"/>` +
          `<path d="M236 220 L296 256 L236 292 Z" fill="hsl(${hue},45%,30%)"/>`
        : "") +
      `<text x="256" y="470" font-family="sans-serif" font-size="28" fill="rgba(255,255,255,.9)" text-anchor="middle">${name.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>` +
      `</svg>`;
    const dataUri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    return {
      adId: `fake_ad_${i + 1}`,
      name,
      spend: Math.round((300 + rand() * 3_000) * 100) / 100,
      impressions,
      clicks,
      installs: Math.round(clicks * (0.1 + rand() * 0.25)),
      creativeType: isVideo ? ("video" as const) : ("image" as const),
      thumbnailUrl: dataUri,
      imageUrl: isVideo ? null : dataUri,
      videoUrl: null,
    };
  });
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
