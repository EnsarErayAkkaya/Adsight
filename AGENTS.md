# Adsight — Electron desktop app for game ad-campaign analytics

Electron + electron-vite + React (renderer) with SQLite (better-sqlite3 + Drizzle) in the main process. There is **no web server**: the renderer talks to the main process only through the typed IPC api in `src/preload` (`window.api.*`), with the contract defined in `src/shared/types.ts`.

- `src/main/` — main process: DB + migrations (`db.ts`, `schema.ts`), Meta/GA4 API clients (`meta.ts`, `ga4.ts`), sync + table assembly (`sync.ts`, `table.ts`), IPC handlers (`ipc.ts`).
- `npm run dev` launches the app with HMR; `npm run package` builds the Windows installer.
- API credentials are configured in the app's Settings screen (`src/main/settings.ts`, safeStorage-encrypted in the `setting` table) — never in `.env`. `.env` holds dev flags only: `META_FAKE=1` / `GA4_FAKE=1` generate deterministic fake data.
- Drizzle migrations in `drizzle/` run automatically at app startup; after schema changes run `npm run db:generate`.
