import { FormEvent, useCallback, useEffect, useState } from "react";
import type { Game } from "@shared/types";
import { PLATFORM_LABELS } from "@shared/types";
import type { Route } from "../App";

export default function GamesView({
  navigate,
}: {
  navigate: (r: Route) => void;
}) {
  const [games, setGames] = useState<Game[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    <main className="mx-auto max-w-3xl space-y-8 p-8">
      <h1 className="text-2xl font-bold">Games</h1>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <ul className="divide-y divide-gray-200 rounded border border-gray-200">
        {games === null && <li className="p-4 text-gray-500">Loading…</li>}
        {games?.length === 0 && (
          <li className="p-4 text-gray-500">No games yet — add one below.</li>
        )}
        {games?.map((g) => (
          <li key={g.id} className="flex items-center justify-between p-4">
            <div>
              <button
                onClick={() => navigate({ view: "game", gameId: g.id })}
                className="font-medium text-blue-600 hover:underline"
              >
                {g.name}
              </button>
              <p className="text-sm text-gray-500">
                GA4 property {g.ga4PropertyId} ·{" "}
                {g.platforms.length > 0
                  ? g.platforms.map((p) => PLATFORM_LABELS[p]).join(" + ")
                  : "no platforms"}{" "}
                · {g.campaignCount} campaign
                {g.campaignCount === 1 ? "" : "s"}
              </p>
            </div>
            <button
              onClick={() => onDelete(g.id)}
              className="text-sm text-red-600 hover:underline"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>

      <section className="rounded border border-gray-200 p-4">
        <h2 className="mb-3 font-semibold">Add game</h2>
        <form onSubmit={onCreate} className="flex flex-wrap gap-3">
          <input
            name="name"
            placeholder="Game name"
            required
            className="rounded border border-gray-300 px-3 py-2"
          />
          <input
            name="ga4PropertyId"
            placeholder="GA4 property ID"
            required
            className="rounded border border-gray-300 px-3 py-2"
          />
          <button className="rounded bg-black px-4 py-2 text-white hover:bg-gray-800">
            Add
          </button>
        </form>
      </section>
    </main>
  );
}
