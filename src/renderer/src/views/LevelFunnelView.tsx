import { useCallback, useEffect, useState } from "react";
import type { LevelFunnel } from "@shared/types";
import { PLATFORM_LABELS } from "@shared/types";
import { FORMATTERS } from "../format";
import type { Route } from "../App";
import TopBar from "../components/TopBar";

const fmt = {
  int: FORMATTERS.int,
  pct: FORMATTERS.pct,
  float1: FORMATTERS.float1,
};

function cell(v: number | null, f: (v: number) => string): string {
  return v === null ? "—" : f(v);
}

/** Soft in-cell meter showing this level's players relative to the max. */
function PlayersBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="tabular-nums">{fmt.int(value)}</span>
      <div className="h-2.5 w-24 rounded-sm bg-surface-1" aria-hidden>
        <div
          className="h-full rounded-sm bg-accent/40"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function LevelFunnelView({
  gameId,
  campaignId,
  navigate,
}: {
  gameId: string;
  campaignId?: string;
  navigate: (r: Route) => void;
}) {
  const [scope, setScope] = useState<"campaign" | "game">(
    campaignId ? "campaign" : "game",
  );
  const [funnel, setFunnel] = useState<LevelFunnel | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setFunnel(undefined);
    setError(null);
    const input =
      scope === "campaign" && campaignId ? { campaignId } : { gameId };
    window.api.analytics
      .levelFunnel(input)
      .then(setFunnel)
      .catch((e) => setError(String(e)));
  }, [scope, campaignId, gameId]);

  useEffect(load, [load]);

  const crumbs = [
    { label: "Games", to: { view: "games" } as Route },
    {
      label: funnel?.gameName ?? "…",
      to: { view: "game", gameId } as Route,
    },
    ...(campaignId
      ? [
          {
            label: funnel?.campaignName ?? "…",
            to: { view: "campaign", campaignId, gameId } as Route,
          },
        ]
      : []),
    { label: "Level funnel" },
  ];

  const scopeToggle = campaignId && (
    <div className="flex rounded-lg border border-edge text-sm" role="tablist">
      {(
        [
          ["campaign", "This campaign"],
          ["game", "Game · all time"],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          role="tab"
          aria-selected={scope === key}
          onClick={() => setScope(key)}
          className={`px-3 py-1 first:rounded-l-lg last:rounded-r-lg focus-visible:outline-2 focus-visible:outline-accent ${
            scope === key
              ? "bg-surface-1 font-medium text-ink"
              : "text-ink-secondary hover:text-ink"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const maxPlayers = funnel?.rows.reduce((m, r) => Math.max(m, r.players), 0) ?? 0;

  return (
    <>
      <TopBar crumbs={crumbs} navigate={navigate} right={scopeToggle} />
      <main className="mx-auto max-w-5xl space-y-4 p-6">
        <div>
          <h1 className="text-base font-medium">
            Level funnel
            {funnel?.scope === "campaign" && funnel.platform && (
              <span className="ml-2 rounded-lg bg-surface-1 px-2 py-0.5 align-middle text-xs font-normal text-ink-secondary">
                {PLATFORM_LABELS[funnel.platform]}
              </span>
            )}
          </h1>
          <p className="text-xs text-ink-secondary">
            {funnel
              ? funnel.scope === "campaign"
                ? `${funnel.campaignName} · ${funnel.startDate} → ${funnel.endDate}`
                : `${funnel.gameName} · all platforms, all time`
              : "Loading…"}
          </p>
        </div>

        {error && (
          <div className="space-y-1 rounded-lg border border-red-300 bg-red-600/10 p-3 text-sm text-red-700 dark:text-red-300">
            <p>{error}</p>
            <p className="text-xs">
              Level analytics needs the <code>level_name</code> and{" "}
              <code>success</code> event parameters registered as event-scoped
              custom dimensions on the GA4 property (Admin → Custom
              definitions).
            </p>
          </div>
        )}

        {funnel?.successDimensionMissing && (
          <p className="rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
            <strong className="font-medium">
              Completion metrics unavailable
            </strong>{" "}
            — the <code>success</code> event parameter isn’t registered as a
            custom dimension on this GA4 property. Register it (Admin → Custom
            definitions → Create custom dimension, scope <em>Event</em>, event
            parameter <code>success</code>) and new data will populate from
            that day forward. Players, churn and attempts still show.
          </p>
        )}

        {!error && funnel === undefined && (
          <div className="overflow-hidden rounded-xl border border-edge bg-surface-2">
            <div className="h-10 border-b border-edge bg-surface-1" />
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className="animate-pulse border-b border-edge p-3 last:border-b-0">
                <div className="h-4 rounded bg-surface-1" />
              </div>
            ))}
          </div>
        )}

        {!error && funnel === null && (
          <p className="text-sm text-ink-secondary">Not found.</p>
        )}

        {funnel && funnel.rows.length === 0 && (
          <div className="rounded-xl border border-edge bg-surface-2 p-8 text-center text-sm text-ink-secondary">
            No level events in this scope yet. Data appears once{" "}
            <code>level_start</code> / <code>level_end</code> events arrive in
            GA4 (typically within 24–48h of being sent).
          </div>
        )}

        {funnel && funnel.rows.length > 0 && (
          <div className="max-h-[calc(100vh-200px)] overflow-auto rounded-xl border border-edge bg-surface-2">
            <table className="w-full border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr>
                  {[
                    "Level",
                    "Players",
                    "Completed",
                    "Completion",
                    "Churn",
                    "Attempts/win",
                    "Avg win time",
                  ].map((h, i) => (
                    <th
                      key={h}
                      className={`sticky top-0 z-10 border-b border-edge bg-surface-1 px-3 py-2 text-xs font-medium text-ink-secondary ${
                        i === 0 ? "text-left" : "text-right"
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {funnel.rows.map((r) => (
                  <tr key={r.level} className="hover:bg-surface-1">
                    <td className="border-b border-edge px-3 py-1.5 font-medium tabular-nums">
                      {r.level}
                    </td>
                    <td className="border-b border-edge px-3 py-1.5 text-right">
                      <PlayersBar value={r.players} max={maxPlayers} />
                    </td>
                    <td className="border-b border-edge px-3 py-1.5 text-right tabular-nums">
                      {cell(r.completedUsers, fmt.int)}
                    </td>
                    <td className="border-b border-edge px-3 py-1.5 text-right tabular-nums">
                      {cell(r.completionPct, fmt.pct)}
                    </td>
                    <td
                      className="border-b border-edge px-3 py-1.5 text-right tabular-nums"
                      title="Players who started this level but never started the next"
                    >
                      {cell(r.churnPct, fmt.pct)}
                    </td>
                    <td className="border-b border-edge px-3 py-1.5 text-right tabular-nums">
                      {cell(r.attemptsPerWin, fmt.float1)}
                    </td>
                    <td
                      className="border-b border-edge px-3 py-1.5 text-right tabular-nums text-ink-muted"
                      title="Requires a numeric duration parameter on level_end, registered as a GA4 custom metric"
                    >
                      {r.avgWinDurationSec === null
                        ? "—"
                        : `${(r.avgWinDurationSec / 60).toFixed(1)}m`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-ink-muted">
          Players = unique users with a <code>level_start</code>; Completed =
          unique users with a winning <code>level_end</code> (success = true).
          Churn = started this level, never started the next; last level has no
          churn. Attempts/win = <code>level_start</code> count ÷ winning{" "}
          <code>level_end</code> count. Avg win time shows “—” until a{" "}
          <code>duration</code> parameter is sent on <code>level_end</code>.
          Queried live from GA4 (not stored locally).
        </p>
      </main>
    </>
  );
}
