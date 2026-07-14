import { useCallback, useEffect, useState } from "react";
import { Line, LineChart } from "recharts";
import type {
  AdSummary,
  CampaignTable,
  ColumnDef,
  ColumnFormat,
  SyncErrors,
  TargetBands,
} from "@shared/types";
import { PLATFORM_LABELS } from "@shared/types";
import { bandClass, bandTitle, formatCell } from "../format";
import type { Route } from "../App";
import TopBar from "../components/TopBar";

/** Which table columns each source feeds — shown so a failure says what to distrust. */
const SOURCE_LABELS: Record<keyof SyncErrors, { name: string; affects: string }> = {
  meta: { name: "Meta Ads", affects: "Spend, CPI, Impressions, Clicks, CTR, eCPI, ROAS" },
  metaAds: { name: "Meta ad creatives", affects: "the Ads section below the table" },
  ga4Installs: { name: "GA4 installs", affects: "Installs, Sess/User, IPM, eCPI" },
  ga4Cohorts: {
    name: "GA4 cohorts",
    affects: "Revenue, ROAS, retention and playtime columns",
  },
};

/**
 * Column-group anchors (§6): acquisition | monetization | engagement.
 * These labels start a new group and draw a separator on their left edge.
 */
const GROUP_STARTS = new Set(["Revenue", "D1"]);

function formatLastSynced(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return new Date(iso).toLocaleString();
}

/**
 * Header sparkline (§6, §11): a trend shape, not a chart — single hue,
 * no axes, no tooltip. Data is chronological even though rows render
 * newest-first.
 */
function HeaderSparkline({
  table,
  columnIndex,
}: {
  table: CampaignTable;
  columnIndex: number;
}) {
  const data = table.rows
    .map((r) => ({ value: r.cells[columnIndex] }))
    .filter((d): d is { value: number } => d.value !== null);
  if (data.length < 2) return <div className="h-5" aria-hidden />;

  const first = data[0].value;
  const last = data[data.length - 1].value;
  const trend = last > first ? "rising" : last < first ? "falling" : "flat";
  return (
    <div
      role="img"
      aria-label={`${table.columns[columnIndex].label} trend: ${trend}`}
    >
      <LineChart
        width={64}
        height={20}
        data={data}
        margin={{ top: 2, right: 0, bottom: 2, left: 0 }}
      >
        <Line
          type="monotone"
          dataKey="value"
          stroke="var(--accent)"
          strokeWidth={1}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </div>
  );
}

function groupBorder(col: ColumnDef): string {
  return GROUP_STARTS.has(col.label) ? "border-l border-edge" : "";
}

/** Stats shown under each ad creative; band-colored where bands exist. */
const AD_STATS: { label: string; format: ColumnFormat; key: keyof AdSummary }[] = [
  { label: "Spend", format: "money", key: "spend" },
  { label: "Installs", format: "int", key: "installs" },
  { label: "CPI", format: "money", key: "cpi" },
  { label: "CTR", format: "pct", key: "ctr" },
  { label: "IPM", format: "float1", key: "ipm" },
];

function AdMedia({ ad }: { ad: AdSummary }) {
  const [broken, setBroken] = useState(false);
  const imageSrc = ad.imageUrl ?? ad.thumbnailUrl;

  if (ad.videoUrl && !broken) {
    return (
      <video
        controls
        preload="metadata"
        src={ad.videoUrl}
        poster={ad.thumbnailUrl ?? undefined}
        onError={() => setBroken(true)}
        className="h-full w-full object-cover"
      />
    );
  }
  if (imageSrc && !broken) {
    return (
      <div className="relative h-full w-full">
        <img
          src={imageSrc}
          alt={ad.name}
          loading="lazy"
          onError={() => setBroken(true)}
          className="h-full w-full object-cover"
        />
        {ad.creativeType === "video" && (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
            video
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center p-3 text-center text-xs text-ink-muted">
      {broken
        ? "preview link expired — Refresh to re-fetch"
        : "no preview available"}
    </div>
  );
}

function AdCard({ ad, bands }: { ad: AdSummary; bands: TargetBands }) {
  return (
    <div className="overflow-hidden rounded-xl border border-edge bg-surface-2">
      <div className="aspect-square w-full bg-surface-1">
        <AdMedia ad={ad} />
      </div>
      <div className="space-y-1.5 p-3">
        <p className="truncate text-sm font-medium" title={ad.name}>
          {ad.name}
        </p>
        <dl className="space-y-0.5">
          {AD_STATS.map(({ label, format, key }) => {
            const v = ad[key] as number | null;
            return (
              <div
                key={label}
                className="flex items-baseline justify-between gap-2 text-[13px]"
              >
                <dt className="text-xs text-ink-secondary">{label}</dt>
                <dd
                  title={bandTitle(label, v, bands, format)}
                  className={`rounded px-1 text-right tabular-nums ${
                    v === null ? "text-ink-muted" : bandClass(label, v, bands)
                  }`}
                >
                  {formatCell(v, format)}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
    </div>
  );
}

/**
 * All ads of the campaign with lifetime stats, spend-descending. Reads what
 * the last sync stored; re-fetches whenever the table reloads (`table`
 * identity changes) so Refresh updates both together.
 */
function AdsSection({
  campaignId,
  table,
}: {
  campaignId: string;
  table: CampaignTable;
}) {
  const [ads, setAds] = useState<AdSummary[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.api.ads
      .forCampaign(campaignId)
      .then((a) => {
        setAds(a);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, [campaignId, table]);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-medium">Ads</h2>
        <p className="text-xs text-ink-secondary">
          Lifetime totals per ad over the campaign window, highest spend
          first. CPI / CTR / IPM tint against the{" "}
          {PLATFORM_LABELS[table.platform]} target bands.
        </p>
      </div>
      {error ? (
        <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
      ) : ads === undefined ? (
        <p className="text-sm text-ink-secondary">Loading ads…</p>
      ) : ads.length === 0 ? (
        <div className="rounded-xl border border-edge bg-surface-2 p-6 text-center text-sm text-ink-secondary">
          No ads stored yet — they arrive with the next successful sync
          (Refresh).
        </div>
      ) : (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]">
          {ads.map((ad) => (
            <AdCard key={ad.adId} ad={ad} bands={table.bands} />
          ))}
        </div>
      )}
    </section>
  );
}

function SkeletonTable() {
  return (
    <div className="overflow-hidden rounded-xl border border-edge bg-surface-2">
      <div className="h-12 border-b border-edge bg-surface-1" />
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="animate-pulse border-b border-edge p-3 last:border-b-0">
          <div className="h-4 rounded bg-surface-1" />
        </div>
      ))}
    </div>
  );
}

export default function CampaignView({
  campaignId,
  gameId,
  navigate,
}: {
  campaignId: string;
  gameId: string;
  navigate: (r: Route) => void;
}) {
  const [table, setTable] = useState<CampaignTable | null | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((initial: boolean) => {
    if (initial) setTable(undefined);
    setRefreshing(true);
    window.api.campaigns
      .getTable(campaignId)
      .then((t) => {
        setTable(t);
        setError(null);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setRefreshing(false));
  }, [campaignId]);

  useEffect(() => load(true), [load]);

  const crumbs = [
    { label: "Games", to: { view: "games" } as Route },
    {
      label: table?.gameName ?? "…",
      to: { view: "game", gameId } as Route,
    },
    { label: table?.campaign.name ?? "…" },
  ];

  if (error) {
    return (
      <>
        <TopBar crumbs={crumbs} navigate={navigate} />
        <main className="p-6 text-sm text-red-700 dark:text-red-300">{error}</main>
      </>
    );
  }
  if (table === undefined) {
    return (
      <>
        <TopBar crumbs={crumbs} navigate={navigate} />
        <main className="mx-auto max-w-6xl space-y-4 p-6">
          <SkeletonTable />
        </main>
      </>
    );
  }
  if (table === null) {
    return (
      <>
        <TopBar crumbs={crumbs} navigate={navigate} />
        <main className="p-6 text-sm text-ink-secondary">Campaign not found.</main>
      </>
    );
  }

  const failures = (
    Object.keys(SOURCE_LABELS) as (keyof SyncErrors)[]
  ).filter((k) => table.sync.errors[k] !== null);
  const partial = failures.length > 0;

  // Most recent day first (§6); Averages stays pinned at the bottom.
  const rowsDesc = [...table.rows];
  const hasCompleted = table.rows.some((r) => r.completed);

  const syncStatus = (
    <div className="flex items-center gap-3">
      <span
        className={`text-xs ${partial ? "text-amber-700 dark:text-amber-400" : "text-ink-secondary"}`}
        title={
          table.sync.lastSyncedAt
            ? new Date(table.sync.lastSyncedAt).toLocaleString()
            : "No fully-successful sync yet"
        }
      >
        {partial ? "Partial sync · " : ""}Last synced:{" "}
        {formatLastSynced(table.sync.lastSyncedAt)}
      </span>
      <button
        onClick={() => load(false)}
        disabled={refreshing}
        className="rounded-lg border border-edge px-3 py-1 text-sm text-ink-secondary hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
      >
        {refreshing ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );

  return (
    <>
      <TopBar crumbs={crumbs} navigate={navigate} right={syncStatus} />
      <main className="mx-auto max-w-[1400px] space-y-4 p-6">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-base font-medium">
              {table.campaign.name}
              <span className="ml-2 rounded-lg bg-surface-1 px-2 py-0.5 align-middle text-xs font-normal text-ink-secondary">
                {PLATFORM_LABELS[table.platform]}
              </span>
            </h1>
            <p className="text-xs text-ink-secondary">
              {table.campaign.startDate} → {table.campaign.endDate} · Meta ID{" "}
              {table.campaign.metaCampaignId} ·{" "}
              {table.campaign.countries.length > 0
                ? `GA4: ${table.campaign.countries.join(", ")}`
                : "GA4: worldwide"}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => navigate({ view: "funnel", gameId, campaignId })}
              className="rounded-lg border border-edge px-3 py-1 text-sm text-ink-secondary hover:text-ink"
            >
              Level funnel
            </button>
            <button
              onClick={() => navigate({ view: "compare" })}
              className="rounded-lg border border-edge px-3 py-1 text-sm text-ink-secondary hover:text-ink"
            >
              Compare…
            </button>
          </div>
        </div>

        {failures.map((k) => (
          <p
            key={k}
            className="rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300"
          >
            <strong className="font-medium">
              {SOURCE_LABELS[k].name} sync failed
            </strong>{" "}
            — showing stored data only for {SOURCE_LABELS[k].affects}.{" "}
            {table.sync.errors[k]}
          </p>
        ))}

        {!hasCompleted ? (
          <div className="rounded-xl border border-edge bg-surface-2 p-8 text-center text-sm text-ink-secondary">
            No completed days yet. Data appears after the first day closes
            (12h past midnight UTC).
          </div>
        ) : (
          <div className="max-h-[calc(100vh-190px)] overflow-auto rounded-xl border border-edge bg-surface-2">
            <table className="w-full border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-20 border-b border-edge bg-surface-1 px-3 py-2 text-left text-xs font-medium text-ink-secondary">
                    Date
                  </th>
                  {table.columns.map((col, i) => (
                    <th
                      key={col.label}
                      className={`sticky top-0 z-10 border-b border-edge bg-surface-1 px-3 py-2 text-right text-xs font-medium text-ink-secondary ${groupBorder(col)}`}
                    >
                      <div className="flex flex-col items-end gap-0.5">
                        <span>{col.label}</span>
                        <HeaderSparkline table={table} columnIndex={i} />
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowsDesc.map((row) => (
                  <tr key={row.date} className="bg-surface-2">
                    <td className="sticky left-0 z-10 whitespace-nowrap border-b border-edge bg-surface-2 px-3 py-1.5 tabular-nums">
                      {row.date}
                      {!row.completed && (
                        <span
                          className="ml-1 text-xs text-ink-muted"
                          title="Day not completed yet (12h buffer)"
                        >
                          ⏳
                        </span>
                      )}
                    </td>
                    {row.cells.map((v, i) => (
                      <td
                        key={table.columns[i].label}
                        title={bandTitle(
                          table.columns[i].label,
                          v,
                          table.bands,
                          table.columns[i].format,
                        )}
                        className={`border-b border-edge px-3 py-1.5 text-right tabular-nums ${groupBorder(table.columns[i])} ${
                          v === null
                            ? "text-ink-muted"
                            : bandClass(table.columns[i].label, v, table.bands)
                        }`}
                      >
                        {formatCell(v, table.columns[i].format)}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="font-medium">
                  <td className="sticky bottom-0 left-0 z-20 border-t-2 border-edge bg-surface-1 px-3 py-2">
                    Averages
                  </td>
                  {table.averages.map((v, i) => (
                    <td
                      key={table.columns[i].label}
                      className={`sticky bottom-0 border-t-2 border-edge bg-surface-1 px-3 py-2 text-right tabular-nums ${groupBorder(table.columns[i])} ${v === null ? "text-ink-muted" : ""}`}
                    >
                      <span
                        className={`inline-block rounded px-1 ${
                          v === null
                            ? ""
                            : bandClass(table.columns[i].label, v, table.bands)
                        }`}
                      >
                        {formatCell(v, table.columns[i].format)}
                      </span>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <AdsSection campaignId={campaignId} table={table} />

        <p className="text-xs text-ink-muted">
          “—” = not yet available (day inside the completion window, or a
          cohort cell that hasn’t matured). Averages skip “—” cells. Cells tint
          red / orange / yellow / green against the global{" "}
          {PLATFORM_LABELS[table.platform]} target bands (Settings). Refresh
          re-pulls missing days, maturing cohort cells and the last 3 completed
          days of Meta spend.
        </p>
      </main>
    </>
  );
}
