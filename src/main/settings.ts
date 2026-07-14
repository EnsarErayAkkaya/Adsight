import { safeStorage } from "electron";
import { eq } from "drizzle-orm";
import type {
  Band,
  PlatformKind,
  SettingsInfo,
  TargetBands,
  UpdateSettingsInput,
} from "@shared/types";
import { BAND_COLUMNS, DEFAULT_TARGET_BANDS } from "@shared/types";
import { db } from "./db";
import { setting } from "./schema";

/** Keys whose values are encrypted at rest with safeStorage. */
const SECRET_KEYS = new Set(["metaAccessToken", "ga4ServiceAccountJson"]);

async function getRaw(key: string): Promise<string | null> {
  const row = await db.query.setting.findFirst({
    where: (setting, { eq }) => eq(setting.key, key),
  });
  if (!row) return null;
  if (row.value.startsWith("enc:")) {
    try {
      return safeStorage.decryptString(Buffer.from(row.value.slice(4), "base64"));
    } catch {
      return null; // key from another machine/user profile — treat as unset
    }
  }
  if (row.value.startsWith("plain:")) return row.value.slice(6);
  return row.value;
}

async function setRaw(key: string, value: string): Promise<void> {
  const stored =
    SECRET_KEYS.has(key) && safeStorage.isEncryptionAvailable()
      ? "enc:" + safeStorage.encryptString(value).toString("base64")
      : "plain:" + value;
  await db
    .insert(setting)
    .values({ key, value: stored })
    .onConflictDoUpdate({ target: setting.key, set: { value: stored } });
}

// --- Typed getters used by the API clients (settings are the only source;
// credentials are never read from .env) ---

export async function getMetaCredentials(): Promise<{
  token: string | null;
  account: string | null;
}> {
  return {
    token: await getRaw("metaAccessToken"),
    account: await getRaw("metaAdAccountId"),
  };
}

export async function getGa4ServiceAccountJson(): Promise<string | null> {
  return getRaw("ga4ServiceAccountJson");
}

export async function getRevenueMetric(): Promise<string> {
  return (await getRaw("ga4RevenueMetric")) || "purchaseRevenue";
}

// --- Global target bands, one set per platform kind (applies to all games) ---

const VALID_LABELS = new Set(BAND_COLUMNS.map((c) => c.label));

/**
 * Stored bands merged over the built-in defaults: a column the user saved
 * wins; every other column falls back to DEFAULT_TARGET_BANDS. Clearing a
 * column in Settings therefore reverts it to the default.
 */
export async function getTargetBands(platform: PlatformKind): Promise<TargetBands> {
  const defaults = DEFAULT_TARGET_BANDS[platform];
  const raw = await getRaw(`targetBands:${platform}`);
  if (!raw) return { ...defaults };
  try {
    return { ...defaults, ...(JSON.parse(raw) as TargetBands) };
  } catch {
    return { ...defaults };
  }
}

export async function setTargetBands(
  platform: PlatformKind,
  bands: TargetBands,
): Promise<void> {
  const clean: TargetBands = {};
  for (const [label, band] of Object.entries(bands)) {
    if (!VALID_LABELS.has(label)) continue;
    const { low, mid, high } = band as Band;
    const values = [low, mid, high].filter((v): v is number => v !== null);
    if (values.length === 0) continue;
    const sorted = [...values].sort((a, b) => a - b);
    if (values.some((v, i) => v !== sorted[i])) {
      throw new Error(`${label}: low ≤ mid ≤ high must hold`);
    }
    clean[label] = { low, mid, high };
  }
  await setRaw(`targetBands:${platform}`, JSON.stringify(clean));
}

// --- IPC-facing info/update (secrets never leave the main process) ---

export async function getSettingsInfo(): Promise<SettingsInfo> {
  const metaToken = await getRaw("metaAccessToken");
  const ga4Json = await getGa4ServiceAccountJson();
  let ga4ClientEmail: string | null = null;
  if (ga4Json) {
    try {
      ga4ClientEmail = (JSON.parse(ga4Json) as { client_email?: string })
        .client_email ?? null;
    } catch {
      // leave null — misconfigured JSON shows as "configured" without email
    }
  }
  return {
    metaTokenConfigured: !!metaToken,
    metaAdAccountId: await getRaw("metaAdAccountId"),
    ga4Configured: !!ga4Json,
    ga4ClientEmail,
    revenueMetric: await getRevenueMetric(),
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
  };
}

/** Applies only the fields present with non-empty values. */
export async function updateSettings(input: UpdateSettingsInput): Promise<void> {
  if (input.metaAccessToken) {
    await setRaw("metaAccessToken", input.metaAccessToken.trim());
  }
  if (input.metaAdAccountId) {
    await setRaw("metaAdAccountId", input.metaAdAccountId.trim().replace(/^act_/, ""));
  }
  if (input.ga4ServiceAccountJson) {
    const json = input.ga4ServiceAccountJson.trim();
    const parsed = JSON.parse(json) as { client_email?: string; private_key?: string };
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error(
        "Service account JSON must contain client_email and private_key",
      );
    }
    await setRaw("ga4ServiceAccountJson", json);
  }
  if (input.revenueMetric !== undefined) {
    await setRaw("ga4RevenueMetric", input.revenueMetric.trim());
  }
}
