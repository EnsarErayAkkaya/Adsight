import { FormEvent, useCallback, useEffect, useState } from "react";
import type { GameDetail, PlatformDetail, PlatformKind } from "@shared/types";
import { PLATFORM_LABELS } from "@shared/types";
import type { Route } from "../App";

export default function GameView({
  gameId,
  navigate,
}: {
  gameId: string;
  navigate: (r: Route) => void;
}) {
  const [game, setGame] = useState<GameDetail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    window.api.games
      .get(gameId)
      .then(setGame)
      .catch((e) => setError(String(e)));
  }, [gameId]);

  useEffect(reload, [reload]);

  if (game === undefined) {
    return <main className="p-8 text-gray-500">Loading…</main>;
  }
  if (game === null) {
    return <main className="p-8 text-gray-500">Game not found.</main>;
  }

  const existing = new Set(game.platforms.map((p) => p.platform));
  const addable = (["ios", "android"] as PlatformKind[]).filter(
    (p) => !existing.has(p),
  );

  async function onAddPlatform(kind: PlatformKind) {
    try {
      await window.api.platforms.create({ gameId, platform: kind });
      setError(null);
      reload();
    } catch (err) {
      setError(String(err));
    }
  }

  async function onDeletePlatform(id: string) {
    await window.api.platforms.delete(id);
    reload();
  }

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-8">
      <div>
        <button
          onClick={() => navigate({ view: "games" })}
          className="text-sm text-blue-600 hover:underline"
        >
          ← Games
        </button>
        <h1 className="mt-1 text-2xl font-bold">{game.name}</h1>
        <p className="text-sm text-gray-500">GA4 property {game.ga4PropertyId}</p>
      </div>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      {game.platforms.length === 0 && (
        <p className="rounded border border-gray-200 p-4 text-gray-500">
          No platforms yet — add one to start creating campaigns.
        </p>
      )}

      {game.platforms.map((p) => (
        <PlatformSection
          key={p.id}
          gameId={gameId}
          platform={p}
          navigate={navigate}
          onDelete={() => onDeletePlatform(p.id)}
          onChanged={reload}
          onError={setError}
        />
      ))}

      {addable.length > 0 && (
        <section className="flex items-center gap-3">
          <span className="text-sm text-gray-600">Add platform:</span>
          {addable.map((kind) => (
            <button
              key={kind}
              onClick={() => onAddPlatform(kind)}
              className="rounded bg-black px-4 py-2 text-sm text-white hover:bg-gray-800"
            >
              + {PLATFORM_LABELS[kind]}
            </button>
          ))}
        </section>
      )}
    </main>
  );
}

function PlatformSection({
  gameId,
  platform,
  navigate,
  onDelete,
  onChanged,
  onError,
}: {
  gameId: string;
  platform: PlatformDetail;
  navigate: (r: Route) => void;
  onDelete: () => void;
  onChanged: () => void;
  onError: (e: string) => void;
}) {
  const [showForm, setShowForm] = useState(false);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    try {
      await window.api.campaigns.create({
        platformId: platform.id,
        name: String(data.get("name") ?? ""),
        metaCampaignId: String(data.get("metaCampaignId") ?? ""),
        startDate: String(data.get("startDate") ?? ""),
        endDate: String(data.get("endDate") ?? ""),
      });
      form.reset();
      setShowForm(false);
      onChanged();
    } catch (err) {
      onError(String(err));
    }
  }

  async function onDeleteCampaign(id: string) {
    await window.api.campaigns.delete(id);
    onChanged();
  }

  return (
    <section className="rounded border border-gray-200">
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-3">
        <h2 className="font-semibold">
          {PLATFORM_LABELS[platform.platform]}
          <span className="ml-2 text-sm font-normal text-gray-500">
            {platform.campaigns.length} campaign
            {platform.campaigns.length === 1 ? "" : "s"}
          </span>
        </h2>
        <button
          onClick={onDelete}
          className="text-sm text-red-600 hover:underline"
        >
          Remove platform
        </button>
      </div>

      <ul className="divide-y divide-gray-100">
        {platform.campaigns.length === 0 && (
          <li className="p-4 text-sm text-gray-500">No campaigns yet.</li>
        )}
        {platform.campaigns.map((c) => (
          <li key={c.id} className="flex items-center justify-between p-4">
            <div>
              <button
                onClick={() =>
                  navigate({ view: "campaign", campaignId: c.id, gameId })
                }
                className="font-medium text-blue-600 hover:underline"
              >
                {c.name}
              </button>
              <p className="text-sm text-gray-500">
                {c.startDate} → {c.endDate} · Meta ID {c.metaCampaignId}
              </p>
            </div>
            <button
              onClick={() => onDeleteCampaign(c.id)}
              className="text-sm text-red-600 hover:underline"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>

      <div className="border-t border-gray-100 p-4">
        {!showForm ? (
          <button
            onClick={() => setShowForm(true)}
            className="text-sm text-blue-600 hover:underline"
          >
            + Add campaign
          </button>
        ) : (
          <form onSubmit={onCreate} className="grid gap-3 sm:grid-cols-2">
            <input
              name="name"
              placeholder="Campaign name"
              required
              className="rounded border border-gray-300 px-3 py-2"
            />
            <input
              name="metaCampaignId"
              placeholder="Meta campaign ID"
              required
              className="rounded border border-gray-300 px-3 py-2"
            />
            <label className="flex items-center gap-2 text-sm text-gray-600">
              Start
              <input
                type="date"
                name="startDate"
                required
                className="flex-1 rounded border border-gray-300 px-3 py-2"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              End
              <input
                type="date"
                name="endDate"
                required
                className="flex-1 rounded border border-gray-300 px-3 py-2"
              />
            </label>
            <div className="flex gap-3 sm:col-span-2">
              <button className="rounded bg-black px-4 py-2 text-white hover:bg-gray-800">
                Add campaign
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded border border-gray-300 px-4 py-2 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
