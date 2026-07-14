import { FormEvent, useCallback, useEffect, useState } from "react";
import type { Band, PlatformKind, SettingsInfo, TargetBands } from "@shared/types";
import { BAND_COLUMNS, PLATFORM_LABELS } from "@shared/types";
import type { Route } from "../App";
import TopBar from "../components/TopBar";

const inputClass =
  "rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent";

/** Percent-formatted columns are edited as % but stored as fractions. */
const scaleFor = (format: string) => (format === "pct" ? 100 : 1);

type BandDraft = Record<string, { low: string; mid: string; high: string }>;

function draftFrom(bands: TargetBands): BandDraft {
  const draft: BandDraft = {};
  for (const col of BAND_COLUMNS) {
    const scale = scaleFor(col.format);
    const band = bands[col.label];
    const show = (v: number | null | undefined) =>
      v === null || v === undefined ? "" : String(v * scale);
    draft[col.label] = {
      low: show(band?.low),
      mid: show(band?.mid),
      high: show(band?.high),
    };
  }
  return draft;
}

/**
 * Live red→green ramp preview (§5.3): four zone swatches with the boundary
 * values between them, mirrored for lower-is-better columns. Bands are
 * abstract until you see the color they produce.
 */
function BandPreview({
  draft,
  lowerIsBetter,
}: {
  draft: { low: string; mid: string; high: string };
  lowerIsBetter: boolean;
}) {
  const nums = [draft.low, draft.mid, draft.high].map((s) => {
    const n = Number(s);
    return s.trim() === "" || isNaN(n) ? null : n;
  });
  const complete = nums.every((n) => n !== null);
  if (!complete) {
    return (
      <div className="flex h-4 items-center text-xs text-ink-muted">
        no coloring (band incomplete)
      </div>
    );
  }
  // Swatches along the ascending value axis, worst→best for higher-better.
  const ramp = [
    "bg-red-600/50",
    "bg-orange-500/50",
    "bg-yellow-500/60",
    "bg-green-600/50",
  ];
  const zones = lowerIsBetter ? [...ramp].reverse() : ramp;
  return (
    <div className="flex items-center gap-1">
      {zones.map((cls, i) => (
        <span key={i} className="flex items-center gap-1">
          <span className={`h-2.5 w-7 rounded-sm ${cls}`} />
          {i < 3 && (
            <span className="text-[10px] tabular-nums text-ink-muted">
              {nums[i]}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

function BandsEditor({
  platform,
  bands,
  onSaved,
}: {
  platform: PlatformKind;
  bands: TargetBands;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<BandDraft>(() => draftFrom(bands));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => setDraft(draftFrom(bands)), [bands]);

  function setPart(label: string, part: "low" | "mid" | "high", value: string) {
    setDraft((d) => ({ ...d, [label]: { ...d[label], [part]: value } }));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next: TargetBands = {};
    for (const col of BAND_COLUMNS) {
      const scale = scaleFor(col.format);
      const num = (raw: string): number | null => {
        if (!raw.trim()) return null;
        const n = Number(raw);
        return isNaN(n) ? null : n / scale;
      };
      const d = draft[col.label];
      next[col.label] = {
        low: num(d.low),
        mid: num(d.mid),
        high: num(d.high),
      } as Band;
    }
    setSaving(true);
    try {
      await window.api.targets.set(platform, next);
      setError(null);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
      onSaved();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <h3 className="text-sm font-medium">{PLATFORM_LABELS[platform]}</h3>
      {error && (
        <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-ink-secondary">
            <th className="py-1 font-medium">Column</th>
            <th className="py-1 font-medium">Low</th>
            <th className="py-1 font-medium">Mid</th>
            <th className="py-1 font-medium">High</th>
            <th className="py-1 font-medium">Preview</th>
          </tr>
        </thead>
        <tbody>
          {BAND_COLUMNS.map((col) => (
            <tr key={col.label}>
              <td className="py-1 pr-3 whitespace-nowrap">
                {col.label}
                <span className="ml-1 text-xs text-ink-muted">
                  {col.format === "pct" ? "%" : col.format === "money" ? "$" : ""}
                  {col.lowerIsBetter ? " ↓ lower is better" : " ↑ higher is better"}
                </span>
              </td>
              {(["low", "mid", "high"] as const).map((part) => (
                <td key={part} className="py-1 pr-2">
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={draft[col.label][part]}
                    onChange={(e) => setPart(col.label, part, e.target.value)}
                    className="w-20 rounded-lg border border-edge bg-surface-2 px-2 py-1 tabular-nums focus-visible:outline-2 focus-visible:outline-accent"
                  />
                </td>
              ))}
              <td className="py-1">
                <BandPreview
                  draft={draft[col.label]}
                  lowerIsBetter={col.lowerIsBetter}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        disabled={saving}
        className="rounded-lg bg-accent px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-50"
      >
        {saving
          ? "Saving…"
          : savedFlash
            ? "Saved ✓"
            : `Save ${PLATFORM_LABELS[platform]} bands`}
      </button>
    </form>
  );
}

function ConfiguredBadge({ configured }: { configured: boolean }) {
  return configured ? (
    <span className="rounded bg-green-600/10 px-2 py-0.5 text-xs font-normal text-green-700 dark:text-green-300">
      configured
    </span>
  ) : (
    <span className="rounded bg-surface-1 px-2 py-0.5 text-xs font-normal text-ink-secondary">
      not set
    </span>
  );
}

export default function SettingsView({
  navigate,
}: {
  navigate: (r: Route) => void;
}) {
  const [info, setInfo] = useState<SettingsInfo | null>(null);
  const [allBands, setAllBands] = useState<Record<PlatformKind, TargetBands> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(() => {
    window.api.settings
      .get()
      .then(setInfo)
      .catch((e) => setError(String(e)));
    window.api.targets
      .get()
      .then(setAllBands)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(reload, [reload]);

  const crumbs = [
    { label: "Games", to: { view: "games" } as Route },
    { label: "Settings" },
  ];

  if (!info) {
    return (
      <>
        <TopBar crumbs={crumbs} navigate={navigate} />
        <main className="mx-auto max-w-2xl space-y-4 p-6">
          <div className="h-40 animate-pulse rounded-xl border border-edge bg-surface-2" />
          <div className="h-40 animate-pulse rounded-xl border border-edge bg-surface-2" />
        </main>
      </>
    );
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const val = (name: string) => String(data.get(name) ?? "").trim();
    setSaving(true);
    setSaved(false);
    try {
      await window.api.settings.update({
        // empty fields are left unchanged
        metaAccessToken: val("metaAccessToken") || undefined,
        metaAdAccountId: val("metaAdAccountId") || undefined,
        ga4ServiceAccountJson: val("ga4ServiceAccountJson") || undefined,
        revenueMetric:
          val("revenueMetric") !== info!.revenueMetric
            ? val("revenueMetric")
            : undefined,
      });
      form.reset();
      setError(null);
      setSaved(true);
      reload();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <TopBar crumbs={crumbs} navigate={navigate} />
      <main className="mx-auto max-w-2xl space-y-6 p-6">
        <div>
          <h1 className="text-base font-medium">Settings</h1>
          <p className="text-xs text-ink-secondary">
            Credentials are stored in the local database
            {info.encryptionAvailable
              ? ", encrypted with the OS keychain."
              : ". ⚠ OS encryption unavailable — they would be stored in plain text."}
          </p>
        </div>

        {error && (
          <p className="rounded-lg border border-red-300 bg-red-600/10 p-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
        {saved && !error && (
          <p className="rounded-lg border border-green-400/40 bg-green-600/10 p-3 text-sm text-green-700 dark:text-green-300">
            Settings saved.
          </p>
        )}

        <form onSubmit={onSubmit} className="space-y-6">
          <section className="space-y-3 rounded-xl border border-edge bg-surface-2 p-4">
            <h2 className="text-sm font-medium">
              Meta Marketing API{" "}
              <ConfiguredBadge configured={info.metaTokenConfigured} />
            </h2>
            <label className="block text-sm">
              <span className="text-ink-secondary">
                Access token (leave blank to keep current)
              </span>
              <input
                name="metaAccessToken"
                type="password"
                autoComplete="off"
                placeholder="EAAB…"
                className={`mt-1 w-full ${inputClass}`}
              />
            </label>
            <label className="block text-sm">
              <span className="text-ink-secondary">
                Ad account ID (digits only)
              </span>
              <input
                name="metaAdAccountId"
                placeholder={info.metaAdAccountId ?? "1234567890"}
                className={`mt-1 w-full ${inputClass}`}
              />
            </label>
          </section>

          <section className="space-y-3 rounded-xl border border-edge bg-surface-2 p-4">
            <h2 className="text-sm font-medium">
              GA4 Data API <ConfiguredBadge configured={info.ga4Configured} />
            </h2>
            {info.ga4ClientEmail && (
              <p className="text-xs text-ink-secondary">
                Service account: {info.ga4ClientEmail}
              </p>
            )}
            <label className="block text-sm">
              <span className="text-ink-secondary">
                Service account key JSON (leave blank to keep current)
              </span>
              <textarea
                name="ga4ServiceAccountJson"
                rows={4}
                autoComplete="off"
                placeholder='{"type":"service_account", …}'
                className={`mt-1 w-full font-mono text-xs ${inputClass}`}
              />
            </label>
            <label className="block text-sm">
              <span className="text-ink-secondary">
                Revenue metric (purchaseRevenue, or customEvent:price)
              </span>
              <input
                name="revenueMetric"
                defaultValue={info.revenueMetric}
                className={`mt-1 w-full ${inputClass}`}
              />
            </label>
          </section>

          <button
            disabled={saving}
            className="rounded-lg bg-accent px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save settings"}
          </button>
        </form>

        <section className="space-y-6 rounded-xl border border-edge bg-surface-2 p-4">
          <div>
            <h2 className="text-sm font-medium">Target bands</h2>
            <p className="text-xs text-ink-secondary">
              Global per platform — applied to every game and campaign. Low /
              mid / high split each column into red, orange, yellow and green
              zones (mirrored for lower-is-better columns). Every column starts
              with built-in defaults; edit and save to override. Clearing a row
              and saving reverts that column to its default.
            </p>
          </div>
          {allBands ? (
            <>
              <BandsEditor platform="ios" bands={allBands.ios} onSaved={reload} />
              <BandsEditor
                platform="android"
                bands={allBands.android}
                onSaved={reload}
              />
            </>
          ) : (
            <p className="text-sm text-ink-secondary">Loading…</p>
          )}
        </section>
      </main>
    </>
  );
}
