import { FormEvent, useCallback, useEffect, useState } from "react";
import type {
  Campaign,
  GameDetail,
  MetaCampaignOption,
  PlatformDetail,
  PlatformKind,
} from "@shared/types";
import { PLATFORM_LABELS } from "@shared/types";
import type { Route } from "../App";
import TopBar from "../components/TopBar";

const inputClass =
  "rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent";

/**
 * Add/edit campaign form. The Meta campaign ID comes from a dropdown of the
 * ad account's campaigns; if that list can't be fetched (no credentials,
 * API error) it degrades to a plain text input.
 */
function CampaignForm({
  initial,
  metaOptions,
  metaOptionsError,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  initial?: Campaign;
  metaOptions: MetaCampaignOption[] | null;
  metaOptionsError: string | null;
  onSubmit: (fields: {
    name: string;
    metaCampaignId: string;
    startDate: string;
    endDate: string;
    countries: string[];
  }) => Promise<void>;
  onCancel: () => void;
  submitLabel: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usePicker = metaOptions !== null && metaOptions.length > 0;
  // Keep an unknown stored ID selectable when editing.
  const options =
    usePicker && initial && !metaOptions.some((o) => o.id === initial.metaCampaignId)
      ? [
          {
            id: initial.metaCampaignId,
            name: `(current) ${initial.metaCampaignId}`,
            status: "",
          },
          ...metaOptions,
        ]
      : metaOptions ?? [];

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await onSubmit({
        name: String(data.get("name") ?? ""),
        metaCampaignId: String(data.get("metaCampaignId") ?? ""),
        startDate: String(data.get("startDate") ?? ""),
        endDate: String(data.get("endDate") ?? ""),
        countries: String(data.get("countries") ?? "")
          .split(/[,\s]+/)
          .map((c) => c.trim().toUpperCase())
          .filter(Boolean),
      });
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
      {error && (
        <p className="rounded-lg border border-red-300 bg-red-600/10 p-2 text-sm text-red-700 dark:text-red-300 sm:col-span-2">
          {error}
        </p>
      )}
      <input
        name="name"
        placeholder="Campaign name"
        required
        defaultValue={initial?.name ?? ""}
        className={inputClass}
      />
      {usePicker ? (
        <select
          name="metaCampaignId"
          required
          defaultValue={initial?.metaCampaignId ?? ""}
          className={inputClass}
        >
          <option value="">Select Meta campaign…</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
              {o.status ? ` · ${o.status}` : ""}
            </option>
          ))}
        </select>
      ) : (
        <div className="flex flex-col gap-1">
          <input
            name="metaCampaignId"
            placeholder="Meta campaign ID"
            required
            defaultValue={initial?.metaCampaignId ?? ""}
            className={inputClass}
          />
          {metaOptionsError && (
            <span className="text-xs text-amber-700 dark:text-amber-400">
              Couldn’t load the Meta campaign list ({metaOptionsError}) — enter
              the ID manually.
            </span>
          )}
        </div>
      )}
      <label className="flex items-center gap-2 text-sm text-ink-secondary">
        Start
        <input
          type="date"
          name="startDate"
          required
          defaultValue={initial?.startDate ?? ""}
          className={`flex-1 ${inputClass}`}
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-ink-secondary">
        End
        <input
          type="date"
          name="endDate"
          required
          defaultValue={initial?.endDate ?? ""}
          className={`flex-1 ${inputClass}`}
        />
      </label>
      <div className="flex flex-col gap-1 sm:col-span-2">
        <input
          name="countries"
          placeholder="Countries (ISO codes, e.g. US, CA — blank = worldwide)"
          defaultValue={initial?.countries.join(", ") ?? ""}
          className={inputClass}
        />
        <span className="text-xs text-ink-muted">
          GA4 installs/retention/revenue are filtered to these countries.
          Changing them later re-fetches the campaign’s GA4 data.
        </span>
      </div>
      <div className="flex gap-3 sm:col-span-2">
        <button
          disabled={busy}
          className="rounded-lg bg-accent px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Saving…" : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-edge px-4 py-2 text-sm text-ink-secondary hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function PlatformSection({
  gameId,
  platform,
  metaOptions,
  metaOptionsError,
  navigate,
  onDelete,
  onChanged,
}: {
  gameId: string;
  platform: PlatformDetail;
  metaOptions: MetaCampaignOption[] | null;
  metaOptionsError: string | null;
  navigate: (r: Route) => void;
  onDelete: () => void;
  onChanged: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function onDeleteCampaign(id: string) {
    await window.api.campaigns.delete(id);
    onChanged();
  }

  return (
    <section className="rounded-xl border border-edge bg-surface-2">
      <div className="flex items-center justify-between border-b border-edge bg-surface-1 px-4 py-3">
        <h2 className="text-sm font-medium">
          {PLATFORM_LABELS[platform.platform]}
          <span className="ml-2 font-normal text-ink-secondary">
            {platform.campaigns.length} campaign
            {platform.campaigns.length === 1 ? "" : "s"}
          </span>
        </h2>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowForm(true)}
            className="rounded-lg bg-accent px-3 py-1 text-xs text-white hover:opacity-90"
          >
            Add campaign
          </button>
          <button
            onClick={onDelete}
            className="text-xs text-red-600 hover:underline dark:text-red-400"
          >
            Remove platform
          </button>
        </div>
      </div>

      <ul className="divide-y divide-edge">
        {platform.campaigns.length === 0 && !showForm && (
          <li className="p-4 text-sm text-ink-secondary">
            No campaigns yet. Add one to start pulling daily data.
          </li>
        )}
        {platform.campaigns.map((c) =>
          editingId === c.id ? (
            <li key={c.id} className="p-4">
              <CampaignForm
                initial={c}
                metaOptions={metaOptions}
                metaOptionsError={metaOptionsError}
                submitLabel="Save changes"
                onCancel={() => setEditingId(null)}
                onSubmit={async (fields) => {
                  await window.api.campaigns.update({ id: c.id, ...fields });
                  setEditingId(null);
                  onChanged();
                }}
              />
            </li>
          ) : (
            <li
              key={c.id}
              onClick={() =>
                navigate({ view: "campaign", campaignId: c.id, gameId })
              }
              className="flex cursor-pointer items-center justify-between p-4 hover:bg-surface-1"
            >
              <div>
                <p className="text-sm font-medium">{c.name}</p>
                <p className="text-xs text-ink-secondary">
                  {c.startDate} → {c.endDate} · Meta ID {c.metaCampaignId} ·{" "}
                  {c.countries.length > 0 ? c.countries.join(", ") : "worldwide"}
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingId(c.id);
                  }}
                  className="text-xs text-accent hover:underline"
                >
                  Edit
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteCampaign(c.id);
                  }}
                  className="text-xs text-red-600 hover:underline dark:text-red-400"
                >
                  Delete
                </button>
              </div>
            </li>
          ),
        )}
      </ul>

      {showForm && (
        <div className="border-t border-edge p-4">
          <CampaignForm
            metaOptions={metaOptions}
            metaOptionsError={metaOptionsError}
            submitLabel="Add campaign"
            onCancel={() => setShowForm(false)}
            onSubmit={async (fields) => {
              await window.api.campaigns.create({
                platformId: platform.id,
                ...fields,
              });
              setShowForm(false);
              onChanged();
            }}
          />
        </div>
      )}
    </section>
  );
}

export default function GameView({
  gameId,
  navigate,
}: {
  gameId: string;
  navigate: (r: Route) => void;
}) {
  const [game, setGame] = useState<GameDetail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [metaOptions, setMetaOptions] = useState<MetaCampaignOption[] | null>(null);
  const [metaOptionsError, setMetaOptionsError] = useState<string | null>(null);

  const reload = useCallback(() => {
    window.api.games
      .get(gameId)
      .then(setGame)
      .catch((e) => setError(String(e)));
  }, [gameId]);

  useEffect(reload, [reload]);

  useEffect(() => {
    window.api.meta
      .listCampaigns()
      .then(setMetaOptions)
      .catch((e) => {
        setMetaOptions(null);
        setMetaOptionsError(
          e instanceof Error ? e.message : String(e).slice(0, 200),
        );
      });
  }, []);

  const crumbs = [
    { label: "Games", to: { view: "games" } as Route },
    { label: game?.name ?? "…" },
  ];

  if (game === undefined) {
    return (
      <>
        <TopBar crumbs={crumbs} navigate={navigate} />
        <main className="mx-auto max-w-3xl space-y-4 p-6">
          <div className="h-24 animate-pulse rounded-xl border border-edge bg-surface-2" />
          <div className="h-24 animate-pulse rounded-xl border border-edge bg-surface-2" />
        </main>
      </>
    );
  }
  if (game === null) {
    return (
      <>
        <TopBar crumbs={crumbs} navigate={navigate} />
        <main className="p-6 text-sm text-ink-secondary">Game not found.</main>
      </>
    );
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
    <>
      <TopBar crumbs={crumbs} navigate={navigate} />
      <main className="mx-auto max-w-3xl space-y-6 p-6">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-base font-medium">{game.name}</h1>
            <p className="text-xs text-ink-secondary">
              GA4 property {game.ga4PropertyId}
            </p>
          </div>
          <button
            onClick={() => navigate({ view: "funnel", gameId })}
            className="rounded-lg border border-edge px-3 py-1 text-sm text-ink-secondary hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
          >
            Level funnel
          </button>
        </div>

        {error && (
          <p className="rounded-lg border border-red-300 bg-red-600/10 p-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}

        {game.platforms.length === 0 && (
          <p className="rounded-xl border border-edge bg-surface-2 p-4 text-sm text-ink-secondary">
            No platforms yet — add one to start creating campaigns.
          </p>
        )}

        {game.platforms.map((p) => (
          <PlatformSection
            key={p.id}
            gameId={gameId}
            platform={p}
            metaOptions={metaOptions}
            metaOptionsError={metaOptionsError}
            navigate={navigate}
            onDelete={() => onDeletePlatform(p.id)}
            onChanged={reload}
          />
        ))}

        {addable.length > 0 && (
          <section className="flex items-center gap-3">
            <span className="text-sm text-ink-secondary">Add platform:</span>
            {addable.map((kind) => (
              <button
                key={kind}
                onClick={() => onAddPlatform(kind)}
                className="rounded-lg border border-edge px-3 py-1.5 text-sm text-ink-secondary hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
              >
                + {PLATFORM_LABELS[kind]}
              </button>
            ))}
          </section>
        )}
      </main>
    </>
  );
}
