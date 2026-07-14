import { FormEvent, useCallback, useEffect, useState } from "react";
import type { Game } from "@shared/types";
import { PLATFORM_LABELS } from "@shared/types";
import type { Route } from "../App";
import TopBar from "../components/TopBar";

export default function GamesView({
  navigate,
}: {
  navigate: (r: Route) => void;
}) {
  const [games, setGames] = useState<Game[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

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
          {games?.length === 0 && (
            <li className="p-6 text-sm text-ink-secondary">
              No games yet. Create one to start tracking its campaigns.
            </li>
          )}
          {games?.map((g) => (
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
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(g.id);
                }}
                className="text-xs text-red-600 hover:underline dark:text-red-400"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
