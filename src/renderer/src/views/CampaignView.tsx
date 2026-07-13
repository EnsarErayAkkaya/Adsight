import { useCallback, useEffect, useState } from "react";
import type { CampaignTable, Cell, ColumnFormat, SyncErrors } from "@shared/types";
import { PLATFORM_LABELS } from "@shared/types";
import type { Route } from "../App";

const FORMATTERS: Record<ColumnFormat, (v: number) => string> = {
  money: (v) => `$${v.toFixed(2)}`,
  int: (v) => Math.round(v).toLocaleString("en-US"),
  pct: (v) => `${(v * 100).toFixed(1)}%`,
  float1: (v) => v.toFixed(1),
  minutes: (v) => `${(v / 60).toFixed(1)}m`,
};

/** Which table columns each source feeds — shown so a failure says what to distrust. */
const SOURCE_LABELS: Record<keyof SyncErrors, { name: string; affects: string }> = {
  meta: { name: "Meta Ads", affects: "Spend, Impressions, Clicks, CTR, eCPI" },
  ga4Installs: { name: "GA4 installs", affects: "Installs, IPM, eCPI" },
  ga4Cohorts: { name: "GA4 cohorts", affects: "retention and playtime columns" },
};

function formatLastSynced(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return new Date(iso).toLocaleString();
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

  if (error) {
    return <main className="p-8 text-red-600">{error}</main>;
  }
  if (table === undefined) {
    return <main className="p-8 text-gray-500">Syncing & loading table…</main>;
  }
  if (table === null) {
    return <main className="p-8 text-gray-500">Campaign not found.</main>;
  }

  const failures = (
    Object.keys(SOURCE_LABELS) as (keyof SyncErrors)[]
  ).filter((k) => table.sync.errors[k] !== null);

  const renderCell = (v: Cell, format: ColumnFormat) =>
    v === null ? (
      <span className="text-gray-400">—</span>
    ) : (
      FORMATTERS[format](v)
    );

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-8">
      <div className="flex items-end justify-between">
        <div>
          <button
            onClick={() => navigate({ view: "game", gameId })}
            className="text-sm text-blue-600 hover:underline"
          >
            ← {table.gameName}
          </button>
          <h1 className="mt-1 text-2xl font-bold">
            {table.campaign.name}
            <span className="ml-2 rounded bg-gray-100 px-2 py-1 align-middle text-sm font-medium text-gray-600">
              {PLATFORM_LABELS[table.platform]}
            </span>
          </h1>
          <p className="text-sm text-gray-500">
            {table.campaign.startDate} → {table.campaign.endDate} · Meta ID{" "}
            {table.campaign.metaCampaignId}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className="text-sm text-gray-500"
            title={
              table.sync.lastSyncedAt
                ? new Date(table.sync.lastSyncedAt).toLocaleString()
                : "No fully-successful sync yet"
            }
          >
            Last synced: {formatLastSynced(table.sync.lastSyncedAt)}
          </span>
          <button
            onClick={() => load(false)}
            disabled={refreshing}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      {failures.map((k) => (
        <p
          key={k}
          className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800"
        >
          <strong>{SOURCE_LABELS[k].name} sync failed</strong> — showing stored
          data only for {SOURCE_LABELS[k].affects}. {table.sync.errors[k]}
        </p>
      ))}

      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left">
              <th className="px-3 py-2 font-medium">Date</th>
              {table.columns.map((col) => (
                <th key={col.label} className="px-3 py-2 text-right font-medium">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr
                key={row.date}
                className="border-b border-gray-100 last:border-b-0"
              >
                <td className="whitespace-nowrap px-3 py-2">
                  {row.date}
                  {!row.completed && (
                    <span
                      className="ml-1 text-xs text-gray-400"
                      title="Day not completed yet (36h buffer)"
                    >
                      ⏳
                    </span>
                  )}
                </td>
                {row.cells.map((v, i) => (
                  <td
                    key={table.columns[i].label}
                    className="px-3 py-2 text-right"
                  >
                    {renderCell(v, table.columns[i].format)}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="bg-gray-50 font-medium">
              <td className="px-3 py-2">Averages</td>
              {table.averages.map((v, i) => (
                <td
                  key={table.columns[i].label}
                  className="px-3 py-2 text-right"
                >
                  {renderCell(v, table.columns[i].format)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400">
        “—” = not yet available (day inside the 36-hour completion window, or a
        retention/playtime cell that hasn’t matured). Averages skip “—” cells.
        Refresh re-pulls missing days, maturing cohort cells and the last{" "}
        3 completed days of Meta spend.
      </p>
    </main>
  );
}
