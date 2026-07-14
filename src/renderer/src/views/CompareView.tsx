import { useEffect, useState } from "react";
import type { CampaignListItem, CampaignTable } from "@shared/types";
import { PLATFORM_LABELS } from "@shared/types";
import { bandClass, formatCell } from "../format";
import type { Route } from "../App";
import TopBar from "../components/TopBar";

function campaignLabel(c: CampaignListItem): string {
  return `${c.gameName} · ${PLATFORM_LABELS[c.platform]} · ${c.name} (${c.startDate})`;
}

function Picker({
  campaigns,
  value,
  exclude,
  onChange,
  placeholder,
}: {
  campaigns: CampaignListItem[];
  value: string;
  exclude: string;
  onChange: (id: string) => void;
  placeholder: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent"
    >
      <option value="">{placeholder}</option>
      {campaigns
        .filter((c) => c.id !== exclude)
        .map((c) => (
          <option key={c.id} value={c.id}>
            {campaignLabel(c)}
          </option>
        ))}
    </select>
  );
}

/** Higher is better for every metric except these (lower is better). */
const LOWER_IS_BETTER = new Set(["Spend", "CPI", "eCPI"]);

export default function CompareView({
  navigate,
}: {
  navigate: (r: Route) => void;
}) {
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  const [idA, setIdA] = useState("");
  const [idB, setIdB] = useState("");
  const [tableA, setTableA] = useState<CampaignTable | null>(null);
  const [tableB, setTableB] = useState<CampaignTable | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.api.campaigns
      .listAll()
      .then(setCampaigns)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!idA || !idB) return;
    setLoading(true);
    setTableA(null);
    setTableB(null);
    Promise.all([
      window.api.campaigns.getTable(idA),
      window.api.campaigns.getTable(idB),
    ])
      .then(([a, b]) => {
        setTableA(a);
        setTableB(b);
        setError(null);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [idA, idB]);

  const ready = tableA && tableB;

  return (
    <>
      <TopBar
        crumbs={[
          { label: "Games", to: { view: "games" } },
          { label: "Compare campaigns" },
        ]}
        navigate={navigate}
      />
      <main className="mx-auto max-w-4xl space-y-4 p-6">
        <div>
          <h1 className="text-base font-medium">Compare campaigns</h1>
          <p className="text-xs text-ink-secondary">
            Averages across all completed days, side by side.
          </p>
        </div>

        {error && (
          <p className="rounded-lg border border-red-300 bg-red-600/10 p-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Picker
            campaigns={campaigns}
            value={idA}
            exclude={idB}
            onChange={setIdA}
            placeholder="Select campaign A…"
          />
          <Picker
            campaigns={campaigns}
            value={idB}
            exclude={idA}
            onChange={setIdB}
            placeholder="Select campaign B…"
          />
        </div>

        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 6 }, (_, i) => (
              <div
                key={i}
                className="h-6 animate-pulse rounded bg-surface-1"
              />
            ))}
          </div>
        )}

        {!idA && !idB && !loading && (
          <p className="rounded-xl border border-edge bg-surface-2 p-6 text-sm text-ink-secondary">
            Pick two campaigns to compare their averages. Opening a comparison
            syncs both.
          </p>
        )}

        {ready && (
          <div className="overflow-x-auto rounded-xl border border-edge bg-surface-2">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-edge bg-surface-1 text-left">
                  <th className="px-3 py-2 text-xs font-medium text-ink-secondary">
                    Metric (avg)
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-ink-secondary">
                    {tableA.campaign.name}
                    <span className="ml-1 font-normal text-ink-muted">
                      ({PLATFORM_LABELS[tableA.platform]})
                    </span>
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-ink-secondary">
                    {tableB.campaign.name}
                    <span className="ml-1 font-normal text-ink-muted">
                      ({PLATFORM_LABELS[tableB.platform]})
                    </span>
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-ink-secondary">
                    B vs A
                  </th>
                </tr>
              </thead>
              <tbody>
                {tableA.columns.map((col, i) => {
                  const a = tableA.averages[i];
                  const b = tableB.averages[i];
                  let delta = "—";
                  let deltaClass = "text-ink-muted";
                  if (a !== null && b !== null && a !== 0) {
                    const change = (b - a) / Math.abs(a);
                    const arrow = change > 0 ? "▲" : change < 0 ? "▼" : "";
                    delta = `${arrow} ${change >= 0 ? "+" : ""}${(change * 100).toFixed(1)}%`;
                    const better = LOWER_IS_BETTER.has(col.label)
                      ? change < 0
                      : change > 0;
                    deltaClass =
                      Math.abs(change) < 0.005
                        ? "text-ink-secondary"
                        : better
                          ? "font-medium text-green-700 dark:text-green-300"
                          : "font-medium text-red-700 dark:text-red-300";
                  }
                  return (
                    <tr
                      key={col.label}
                      className="border-b border-edge last:border-b-0"
                    >
                      <td className="px-3 py-2 font-medium">{col.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span
                          className={`inline-block rounded px-1 ${a === null ? "text-ink-muted" : bandClass(col.label, a, tableA.bands)}`}
                        >
                          {formatCell(a, col.format)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span
                          className={`inline-block rounded px-1 ${b === null ? "text-ink-muted" : bandClass(col.label, b, tableB.bands)}`}
                        >
                          {formatCell(b, col.format)}
                        </span>
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${deltaClass}`}
                      >
                        {delta}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {ready && (
          <p className="text-xs text-ink-muted">
            “B vs A” colors green when B is better for that metric (lower for
            Spend/CPI/eCPI, higher otherwise). Values tint against each
            campaign’s own platform bands.
          </p>
        )}
      </main>
    </>
  );
}
