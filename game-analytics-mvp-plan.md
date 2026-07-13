# Game Analytics Platform — MVP Technical Build Plan

**Goal:** A Next.js web app where you register games and, under each game, one or more ad campaigns (with start/end dates). Opening a campaign shows a **daily table**: one row per completed day, merging Meta Ads spend/traffic with GA4 installs, cohort retention, and playtime — plus an averages row.

**Stack:** Next.js (App Router) + Postgres.
**Verified July 2026:** Meta Marketing API **v25.0** (Ads Insights), GA4 **Data API v1beta** (`runReport` + `cohortSpec`).

---

## 1. Core model & flow

- A **game** has many **campaigns**. You add campaigns manually, each with a name, a Meta campaign ID/mapping, a **start date**, and an **end date**.
- Opening a campaign triggers a data request for that game/campaign across all **completed dates** in the campaign's date range.
- **Completed date rule:** a calendar day `D` is "completed" only once **at least 36 hours have passed since the end of `D`** (i.e. `now ≥ midnight(D+1) + 36h`). This buffer lets Meta spend finalize and GA4 finish processing before you trust the numbers. Store `36` as a config constant.

Every day in the campaign's date range gets a row. A day still inside the 36h window renders every metric cell as **`—`** (not blank, not `0`) — the row exists but the data isn't trusted yet. Once the day matures past 36h, its cells populate on the next sync.

**One campaign per game at a time.** Because a game never runs overlapping campaigns, GA4 data for the game *is* the campaign's data. No `firstUserCampaignName` attribution/UTM tagging is needed for the MVP — filter GA4 by the game's property (and the campaign's date window), and filter Meta by the campaign ID. This removes the biggest attribution risk entirely.

---

## 2. The daily table (per selected game + campaign)

One row per completed day `D`, with a final **Averages** row.

| Column | Source | Definition |
|---|---|---|
| Date | — | The day `D` |
| Spend | Meta | Daily ad spend for the campaign on `D` |
| Impressions | Meta | Daily impressions |
| Clicks | Meta | Daily clicks |
| Installs | GA4 | `first_open` count attributed to the campaign on `D` |
| CTR | derived | clicks ÷ impressions |
| IPM | derived | installs ÷ impressions × 1000 (installs per mille) |
| eCPI | derived | spend ÷ installs (effective cost per install) |
| D1, D2, D3, D4, D6, D7 Retention | GA4 cohort | Of the users who installed on `D`, the % still active on day `D+n` |
| D0, D1, D2, D3 Play time | GA4 cohort | Avg engagement/session duration of the `D` install-cohort on day `D+n` (D0 = install day) |
| **Averages** row | derived | Column average across all shown days |

**Two important nuances to build for:**

1. **`—` has two causes, both rendered identically.** A cell shows `—` when either (a) the day itself isn't completed yet (< 36h past), or (b) the day is completed but that specific retention/playtime cell hasn't matured — D7 retention for day `D` isn't real until ~day `D+8`, so a completed day's right-hand cells still fill in progressively. In both cases render `—`, never `0`, so "no data yet" is never mistaken for "zero retention."
2. **Averages ignore `—` cells.** Each column average divides by the number of days that actually have a real value, not by every row — otherwise immature/incomplete days drag averages down artificially.

---

## 3. Architecture

```
   Meta Marketing API v25.0 ─┐
                             ├─▶  Next.js (Vercel)                Postgres
   GA4 Data API v1beta ──────┘     /api/sync/campaign  ───────▶  raw daily +
                                    /api/campaign/[id]  ◀───────  cohort tables
                                    React table (RSC)
```

- **Framework:** Next.js App Router. Route Handlers run syncs; Server Components render the table.
- **DB:** Postgres (Supabase or Neon). ORM: Prisma or Drizzle.
- **Sync trigger:** on opening a campaign, `/api/sync/campaign` fetches any missing completed days, upserts, then the page reads from the DB. A nightly Vercel Cron also refreshes active campaigns so retention cells backfill automatically.
- **Table UI:** TanStack Table + Tremor/Recharts. No heavy charting needed for MVP — the table is the product.
- **Auth:** single-password middleware for now.

**Cache/sync logic:** never re-fetch a day whose full retention window (through D7) is already mature and stored. For days still accruing retention, re-fetch on each open/cron until D7 exists.

---

## 4. Data model (Postgres)

```sql
game (
  id            text primary key,
  name          text not null,
  ga4_property_id text not null
)

campaign (
  id            text primary key,
  game_id       text references game(id),
  name          text not null,
  meta_campaign_id text not null,       -- for Meta Insights filtering
  start_date    date not null,
  end_date      date not null
)
-- Note: no per-campaign GA4 field needed. One campaign per game at a time,
-- so GA4 is filtered by the game's property + the campaign date window.

-- Meta traffic/spend, one row per campaign per day
meta_daily (
  campaign_id   text references campaign(id),
  date          date,
  spend         numeric,
  impressions   bigint,
  clicks        bigint,
  primary key (campaign_id, date)
)

-- GA4 installs, one row per campaign per install-day
ga4_installs (
  campaign_id   text references campaign(id),
  install_date  date,
  installs      bigint,
  primary key (campaign_id, install_date)
)

-- GA4 cohort cells: retention + playtime by install-day and nth day
ga4_cohort (
  campaign_id   text references campaign(id),
  install_date  date,          -- the cohort's day D
  nth_day       smallint,      -- 0..7
  active_users  bigint,        -- cohortActiveUsers on D+n
  total_users   bigint,        -- cohortTotalUsers (cohort size on D)
  avg_playtime_sec numeric,    -- avg engagement duration on D+n
  primary key (campaign_id, install_date, nth_day)
)
```

The table row for day `D` is assembled by joining `meta_daily` + `ga4_installs` + pivoting `ga4_cohort` (nth_day → columns). Retention% = `active_users / total_users`.

---

## 5. Meta Ads integration (v25.0)

**Endpoint:** `GET /v25.0/act_{AD_ACCOUNT}/insights`
**Params:**
- `level=campaign`, `filtering=[{field:'campaign.id',operator:'IN',value:[META_CAMPAIGN_ID]}]`
- `fields=spend,impressions,clicks`
- `time_range={since, until}` bounded by the campaign's completed date range
- `time_increment=1` → one row per day

**Notes:** use the async job endpoint for the initial multi-day backfill; sync GET is fine for the nightly "new completed day" delta. Handle paging and rate-limit backoff. Pin `v25.0` in config (v23.0 already expired June 2026).

---

## 6. GA4 integration (v1beta)

Two report types per campaign, both scoped to the game's GA4 property over the campaign's date window. Auth via a Google Cloud service account with Viewer on the property. Since only one campaign runs per game at a time, **no campaign-name filter is required** — the property's data over the campaign window *is* the campaign's data.

**(a) Daily installs** — `runReport`:
```json
{
  "dimensions": [{ "name": "date" }],
  "metrics":    [{ "name": "eventCount" }],
  "dateRanges": [{ "startDate": "<campaign start>", "endDate": "<last completed day>" }],
  "dimensionFilter": {
    "filter": { "fieldName": "eventName", "stringFilter": { "value": "first_open" } }
  }
}
```

**(b) Retention + playtime** — `runReport` with `cohortSpec`:
- Cohorts grouped by **`firstSessionDate`** (one cohort per install-day in the range).
- `cohortsRange`: `granularity: DAILY`, `startOffset: 0`, `endOffset: 7`.
- Dimensions: `cohort`, `cohortNthDay`.
- Metrics: `cohortActiveUsers`, `cohortTotalUsers`, and an engagement metric (`userEngagementDuration` / `averageSessionDuration`) for playtime.
- Restrict `cohortsRange` (start/end offsets) to the campaign's date window; no campaign filter needed.

Retention `D_n` = `cohortActiveUsers / cohortTotalUsers` at `cohortNthDay = n`. Pull nth-days 0–7; the table reads 1,2,3,4,6,7 for retention and 0,1,2,3 for playtime.

**Attribution is a non-issue for the MVP.** Because a game runs only one campaign at a time, the game's GA4 property data over the campaign's date range already equals that campaign's data — no UTM tagging or `firstUserCampaignName` filtering required. (Revisit only if you later allow overlapping campaigns per game.)

---

## 7. Milestones

**M0 — Setup (½–1 day):** Next.js on Vercel, Postgres, schema, password auth, `COMPLETED_HOURS=36` config + a `completedDates(range)` helper.

**M1 — Games & campaigns CRUD (1 day):** add/edit games and campaigns (name, Meta ID, GA4 campaign name, start/end).

**M2 — Meta pipeline (1–2 days):** `/api/sync/campaign` pulls daily campaign insights for completed days, upserts `meta_daily`. Verify vs Ads Manager.

**M3 — GA4 installs + cohort pipeline (2–3 days):** installs `runReport` + cohort `runReport`, upsert `ga4_installs` and `ga4_cohort`. Verify a sample cohort against the GA4 Cohort exploration UI.

**M4 — Daily table (2 days):** join + pivot into the column layout, retention/eCPI/IPM/CTR derivations, blank-aware averages row, `—` for immature cells.

**M5 — Automation + polish (1 day):** nightly cron refreshing active campaigns (backfilling retention), last-synced indicator, loading/error states.

**Realistic MVP total: ~8–11 working days** solo.

---

## 8. Risks & decisions to lock early

1. **Completed-date + trailing retention** — the main correctness item. A day is "done" for spend/installs at +36h but its retention keeps maturing for a week. The refresh logic and the `—` / blank-average handling must respect that, or numbers will look wrong. (Campaign attribution is *not* a risk here — one campaign per game removes it.)
2. **Timezone alignment** — Meta reports in the ad account timezone, GA4 in the property timezone. Force both to one timezone or daily rows won't line up.
3. **GA4 quotas** — cohort reports are token-heavy; batch and cache aggressively, don't re-pull mature days.
4. **Secrets** — Meta long-lived token and Google service-account key stay server-side only.

---

## 9. Backlog (post-MVP)

ROAS/revenue once purchase events flow to GA4 · more networks (Google Ads, TikTok, Unity, AppLovin) · D14/D30 retention · charts & trend lines · CSV/Sheets export · multi-user auth.
