import { FormEvent, useCallback, useEffect, useState } from "react";
import type { ColumnFormat, Game, GameStats } from "@shared/types";
import { PLATFORM_LABELS } from "@shared/types";
import { formatCell } from "../format";
import type { Route } from "../App";
import TopBar from "../components/TopBar";

/** Lifetime aggregates shown on each game row (stored data only, see GameStats). */
const GAME_STATS: { label: string; format: ColumnFormat; key: keyof GameStats }[] = [
  { label: "Spend", format: "money", key: "totalSpend" },
  { label: "Installs", format: "int", key: "totalInstalls" },
  { label: "CPI", format: "money", key: "avgCpi" },
  { label: "D1", format: "pct", key: "avgD1" },
];

export default function GamesView({
  navigate,
}: {
  navigate: (r: Route) => void;
}) {
  const [games, setGames] = useState<Game[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const reload = useCallback(() => {
    window.api.games
      .list()
      .then(setGames)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(reload, [reload]);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    try {
      await window.api.games.create({
        name: String(data.get("name") ?? ""),
        ga4PropertyId: String(data.get("ga4PropertyId") ?? ""),
      });
      form.reset();
      setShowForm(false);
      reload();
    } catch (err) {
      setError(String(err));
    }
  }

  async function onDelete(id: string) {
    await window.api.games.delete(id);
    reload();
  }

  async function onSetArchived(id: string, archived: boolean) {
    try {
      await window.api.games.setArchived(id, archived);
      reload();
    } catch (err) {
      setError(String(err));
    }
  }

  const active = games?.filter((g) => g.archivedAt === null);
  const archived = games?.filter((g) => g.archivedAt !== null) ?? [];

  const gameRow = (g: Game) => (
    <li
      key={g.id}
      onClick={() => navigate({ view: "game", gameId: g.id })}
      className="flex cursor-pointer items-center justify-between p-4 hover:bg-surface-1"
    >
      <div>
        <p className="text-sm font-medium">{g.name}</p>
        <p className="text-xs text-ink-secondary">
          GA4 property {g.ga4PropertyId} ·{" "}
          {g.platforms.length > 0
            ? g.platforms.map((p) => PLATFORM_LABELS[p]).join(" + ")
            : "no platforms"}{" "}
          · {g.campaignCount} campaign
          {g.campaignCount === 1 ? "" : "s"}
        </p>
        <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
          {GAME_STATS.map(({ label, format, key }) => (
            <span key={label} className="text-ink-secondary">
              {label}{" "}
              <span
                className={`tabular-nums ${g.stats[key] === null ? "text-ink-muted" : "font-medium text-ink"}`}
              >
                {formatCell(g.stats[key], format)}
              </span>
            </span>
          ))}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSetArchived(g.id, g.archivedAt === null);
          }}
          className="text-xs text-ink-secondary hover:text-ink hover:underline"
        >
          {g.archivedAt === null ? "Archive" : "Unarchive"}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(g.id);
          }}
          className="text-xs text-red-600 hover:underline dark:text-red-400"
        >
          Delete
        </button>
      </div>
    </li>
  );

  return (
    <>
      <TopBar
        crumbs={[{ label: "Games" }]}
        navigate={navigate}
        right={
          <button
            onClick={() => navigate({ view: "compare" })}
            className="rounded-lg border border-edge px-3 py-1 text-sm text-ink-secondary hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
          >
            Compare campaigns
          </button>
        }
      />
      <main className="mx-auto max-w-3xl space-y-6 p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-medium">Games</h1>
          <button
            onClick={() => setShowForm((s) => !s)}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-accent"
          >
            New game
          </button>
        </div>

        {error && (
          <p className="rounded-lg border border-red-300 bg-red-600/10 p-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}

        {showForm && (
          <section className="rounded-xl border border-edge bg-surface-2 p-4">
            <h2 className="mb-3 text-sm font-medium">Add game</h2>
            <form onSubmit={onCreate} className="flex flex-wrap gap-3">
              <input
                name="name"
                placeholder="Game name"
                required
                className="rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent"
              />
              <input
                name="ga4PropertyId"
                placeholder="GA4 property ID"
                required
                className="rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent"
              />
              <button className="rounded-lg bg-accent px-4 py-2 text-sm text-white hover:opacity-90">
                Add
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg border border-edge px-4 py-2 text-sm text-ink-secondary hover:text-ink"
              >
                Cancel
              </button>
            </form>
          </section>
        )}

        <ul className="divide-y divide-edge rounded-xl border border-edge bg-surface-2">
          {games === null &&
            [0, 1, 2].map((i) => (
              <li key={i} className="animate-pulse p-4">
                <div className="h-4 w-40 rounded bg-surface-1" />
                <div className="mt-2 h-3 w-64 rounded bg-surface-1" />
              </li>
            ))}
          {active?.length === 0 && (
            <li className="p-6 text-sm text-ink-secondary">
              {archived.length > 0
                ? "No active games — everything is archived."
                : "No games yet. Create one to start tracking its campaigns."}
            </li>
          )}
          {active?.map(gameRow)}
        </ul>

        {archived.length > 0 && (
          <section>
            <button
              onClick={() => setShowArchived((s) => !s)}
              aria-expanded={showArchived}
              className="flex items-center gap-1.5 text-sm text-ink-secondary hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
            >
              <span
                aria-hidden
                className={`text-xs transition-transform ${showArchived ? "rotate-90" : ""}`}
              >
                ▶
              </span>
              Archived ({archived.length})
            </button>
            {showArchived && (
              <ul className="mt-3 divide-y divide-edge rounded-xl border border-edge bg-surface-2 opacity-80">
                {archived.map(gameRow)}
              </ul>
            )}
          </section>
        )}
      </main>
    </>
  );
}
