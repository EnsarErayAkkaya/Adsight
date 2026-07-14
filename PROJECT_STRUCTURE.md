# Project Structure — Adsight

Electron desktop app for daily game ad-campaign analytics. It pulls spend/traffic
from **Meta Ads** and installs/retention/revenue from **GA4**, stores everything in
a local SQLite database, and renders a per-campaign daily metrics table.

## Stack

| Layer | Technology |
| --- | --- |
| Shell | Electron 42 (electron-vite, electron-builder for the Windows installer) |
| Main process | TypeScript, better-sqlite3 + Drizzle ORM, Zod (IPC input validation) |
| Renderer | React 19, Tailwind CSS 4, Recharts (sparklines) |
| APIs | Meta Marketing API (Graph v25.0), GA4 Data API (v1beta) via google-auth-library JWT |

There is **no web server**: the renderer talks to the main process only through the
typed IPC bridge (`window.api.*`), whose contract lives in `src/shared/types.ts`.

## Directory layout

```
src/
├─ main/                 # Electron main process (Node)
│  ├─ index.ts           # App entry: window creation, IPC registration
│  ├─ config.ts          # Global constants (COMPLETED_HOURS=12, API versions,
│  │                     #   COHORT_MAX_NTH_DAY=7, META_RESTATEMENT_DAYS=3, UTC reporting)
│  ├─ db.ts              # SQLite handle (WAL, FK on); runs drizzle/ migrations at startup
│  ├─ schema.ts          # Drizzle tables: game, platform, campaign, meta_daily,
│  │                     #   ga4_installs, ga4_cohort, setting
│  ├─ dates.ts           # UTC calendar-day helpers; "completed day" logic
│  ├─ meta.ts            # Meta insights client (spend/impressions/clicks/installs)
│  │                     #   + campaign-list picker; fake mode via META_FAKE=1
│  ├─ ga4.ts             # GA4 client: daily installs (first_open), sessions/user,
│  │                     #   D0–D7 cohorts (retention, playtime, revenue); GA4_FAKE=1
│  ├─ sync.ts            # Incremental sync per campaign (3 independent sources)
│  ├─ table.ts           # Assembles the CampaignTable (columns, rows, averages)
│  ├─ settings.ts        # Settings/credentials (safeStorage-encrypted) + target bands
│  └─ ipc.ts             # ipcMain handlers; Zod-validates all renderer input
├─ preload/
│  ├─ index.ts           # contextBridge: exposes the typed api as window.api
│  └─ index.d.ts         # window.api type declaration
├─ renderer/src/         # React UI (state-based routing in App.tsx, no router lib)
│  ├─ App.tsx            # Route union: games | game | campaign | compare | settings
│  ├─ format.ts          # Cell formatters (money/int/pct/float1/minutes) + band coloring
│  └─ views/
│     ├─ GamesView.tsx     # Game list + create/delete
│     ├─ GameView.tsx      # One game: platforms (iOS/Android) + campaign CRUD
│     ├─ CampaignView.tsx  # Daily metrics table, sparklines, sync status/refresh
│     ├─ CompareView.tsx   # Side-by-side comparison of two campaigns' averages
│     └─ SettingsView.tsx  # API credentials, revenue metric, target-band editors
└─ shared/
   └─ types.ts            # IPC contract (Api interface), CampaignTable, ColumnDef,
                          #   band columns + DEFAULT_TARGET_BANDS per platform
drizzle/                  # Generated SQL migrations + snapshots (auto-run at startup)
data/app.db               # Dev database (packaged builds use per-user appData)
```

## Data model

- **game** → has **platform** rows (iOS/Android, unique per game) → each has **campaign**s
  (Meta campaign ID, date window, optional GA4 country filter).
- **meta_daily** — per campaign+day: spend, impressions, clicks, Meta-attributed installs.
- **ga4_installs** — per campaign+day: GA4 `first_open` installs, sessions per user.
- **ga4_cohort** — per campaign+install-day+nth-day (0..7): active/total users,
  avg playtime, cohort revenue.
- **setting** — key/value store; secrets encrypted with Electron `safeStorage`
  (`enc:` prefix), including Meta token and GA4 service-account JSON. Also holds
  per-platform target bands.

All dates are ISO `YYYY-MM-DD` strings bucketed as **UTC calendar days**.

## Sync pipeline (`sync.ts`)

Triggered whenever a campaign table is loaded/refreshed. A day D is **completed**
once `now >= midnight(D+1) UTC + COMPLETED_HOURS` (12h buffer for source data to
finalize); incomplete days render as `—`, never 0.

Three sources sync independently (one failing doesn't block the others):

1. **Meta daily** — fetches completed days missing from `meta_daily`, plus always
   re-fetches the trailing 3 completed days (Meta restates recent spend).
2. **GA4 installs/sessions** — fetches completed days missing from `ga4_installs`
   (rows with a null sessions-per-user re-fetch once, backfilling new columns).
3. **GA4 cohorts** — an install-day is stale while any mature cell (D+n completed)
   is unstored; only mature cells are written, so stored cells are trustworthy.

`campaign.last_synced_at` is stamped only when all three succeed. Failures surface
in the UI as per-source warnings naming the affected columns.

## Campaign table (`table.ts`)

Columns: Spend, Impr., Clicks, Installs, Sess/User, CTR, IPM, **CPI** (spend ÷
Meta-attributed installs), **eCPI** (spend ÷ GA4 installs), Revenue (cumulative
cohort), ROAS D0/D3/D7, retention D1–D7, playtime PT D0–D3. Averages skip `—`
cells. Cells color red→green against per-platform **target bands** (three
ascending boundaries, direction-aware); built-in defaults from
`DEFAULT_TARGET_BANDS` apply until the user overrides a column in Settings.

## Development

| Command | Purpose |
| --- | --- |
| `npm run dev` | Launch app with HMR (renderer hot-reloads; main-process changes need a restart) |
| `npm run typecheck` | `tsc` over both the node and web tsconfigs |
| `npm run db:generate` | Generate a Drizzle migration after editing `schema.ts` |
| `npm run db:studio` | Browse the SQLite DB |
| `npm run package` | Build the Windows installer |
| `npm run rebuild-native` | Rebuild better-sqlite3 against the Electron ABI |

Credentials are configured in the app's **Settings** screen, never in `.env`.
`.env` holds dev flags only: `META_FAKE=1` / `GA4_FAKE=1` generate deterministic
fake data so the whole pipeline runs without API access; `SQLITE_PATH` overrides
the DB location.
