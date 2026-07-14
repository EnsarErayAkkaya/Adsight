# Adsight — Design Decisions

An Electron desktop app for daily game **ad-campaign** analytics. It pulls spend/traffic from Meta Ads and installs/retention/revenue from GA4, stores everything in local SQLite, and renders a **per-campaign daily metrics table**. This document records the UI design decisions and their rationale so an engineer (or Claude Code) can build against them without re-litigating choices. It is grounded in the actual project structure — stack, views, data model, and sync behavior — and is the source of truth where it and any mockup disagree.

---

## 1. Product context

The user is a **user-acquisition / live-ops manager** who opens the app daily to judge whether ad campaigns are profitable: is spend turning into installs at an acceptable cost, and are those installs retaining and paying back (ROAS). The tool exists to answer that per campaign, per day.

Design implications that follow directly from the architecture:

- **The daily metrics table is the product.** Everything else — the games/game hierarchy, compare, settings — exists to get the user into a campaign's table or to configure how that table reads. The table is where design effort concentrates.
- **Local-first, no web server.** The renderer talks to the main process over the typed IPC bridge (`window.api.*`). The UI is a thin, fast React 19 renderer; there are no loading spinners waiting on a network round-trip for navigation, only for syncs.
- **Data is provisional and restated.** Meta restates recent spend, days aren't "completed" until a 12h UTC buffer passes, and three sources sync independently. The UI must represent *incompleteness and partial failure honestly* — this is a first-class design concern, not an edge case.
- **Desktop, dense, Windows-packaged.** Wide tables, tabular numbers, keyboard-friendly. Not mobile.

---

## 2. Design principles

Ranked — when two decisions conflict, the higher one wins.

**Honesty about data state.** An incomplete day renders as `—`, never `0`. A failed source shows a scoped warning naming the affected columns, not a silent gap or a fake zero. The user must always be able to trust that a number on screen is real and final.

**The table reads at a glance.** Target-band coloring (red→green) lets the user scan a wall of numbers and see health without reading each cell. Color here is *data*, and it is the one place color works hard.

**Clarity over decoration.** Flat surfaces, hairline borders, no gradients or shadows. The chrome recedes so the table and its band colors dominate.

**Restraint in the chrome.** One neutral accent for navigation/interactive state. The only loud color in the app is the data-driven band coloring; everything structural stays quiet so that signal isn't drowned.

---

## 3. Navigation & information architecture

**Decision:** State-based routing (the `route` union in `App.tsx`: `games | game | campaign | compare | settings`) rendered as a **drill-down hierarchy** with breadcrumbs, not a persistent sidebar.

```
Games ─▶ Game (platforms + campaigns) ─▶ Campaign (daily table)
                                          └▶ Compare (two campaigns)
Settings (reachable from anywhere)
```

**Why:** The data model is strictly hierarchical — a game *has* platforms, a platform *has* campaigns — so navigation should mirror it. A drill-down with a breadcrumb trail (`Games / Sky Raiders / iOS · Campaign 1234`) keeps the user oriented in that hierarchy far better than a flat sidebar, which would have to flatten a tree it can't represent. Since there's no router library, breadcrumbs also double as the "back" affordance.

**Decision:** A persistent top bar carries the breadcrumb (left), the current sync status / refresh control (center-right on campaign views), and a Settings entry point (far right).

**Why:** Breadcrumb position is stable across every view, so the user always knows where they are and how to go up. Sync status belongs next to the data it describes. Settings is rare, so it sits out of the way.

**Decision:** Compare is entered *from* a campaign or game context (pick a second campaign), not as a top-level destination.

**Why:** Comparison only makes sense relative to a campaign you're already looking at. Launching it in-context pre-fills one side and matches the mental model "compare this to that."

---

## 4. View-by-view layout

### 4.1 Games view (`GamesView`)
A simple list of games with create/delete. Each row shows the game name and a light summary (platform count, campaign count). One primary action: "New game." Rows are ruled, not carded — this is a navigational list, and ruled rows read faster and drill in on click.

### 4.2 Game view (`GameView`)
One game, its platforms (iOS / Android — unique per game), and campaign CRUD under each platform. Group campaigns under a platform subheading so the iOS/Android split is structural, not a column. Each campaign row shows name, Meta campaign ID, date window, and `last_synced_at`. Primary action: "Add campaign" (scoped to a platform).

### 4.3 Campaign view (`CampaignView`) — the hero screen
The daily metrics table fills the content area. Structure top-to-bottom:

1. **Header strip** — campaign name + platform badge, date window, sync status, and a Refresh button.
2. **Sync warnings** (only when present) — a scoped banner per failed source, naming the affected columns.
3. **The table** — one row per completed day (most recent first), a trailing **Averages** row, band-colored cells, and per-column **sparklines** (Recharts) in the header.

Design rules for the table are in §6.

### 4.4 Compare view (`CompareView`)
Two campaigns side by side, comparing their **averages** (not day-by-day). Two columns of the same metric rows, band-colored identically, with the better value in each pair marked. A single delta column between them is optional but helps: it turns "which is better" from a two-step comparison into a one-glance read.

### 4.5 Settings view (`SettingsView`)
Three grouped sections: **API credentials** (Meta token, GA4 service-account JSON — both stored `safeStorage`-encrypted, shown masked with a "replace" affordance, never echoed back in plaintext), **revenue metric** selection, and **target-band editors** per platform per column. The band editor is the most design-sensitive part of settings — see §5.3.

---

## 5. Color

The app has two color systems that must not compete: **neutral chrome** (structure) and **band coloring** (data). Band coloring is the only saturated color in the interface.

### 5.1 Chrome — neutral, light-default, dark supported
Every color is a token that resolves in both themes.

| Token | Light | Role |
|---|---|---|
| `--surface-0` | `#f7f6f2` | app background |
| `--surface-1` | `#f1efe8` | recessed rows / grouped fields |
| `--surface-2` | `#ffffff` | raised surfaces: top bar, cards, table |
| `--text-primary` | near-black | values, headings, table cells |
| `--text-secondary` | muted | labels, breadcrumb, supporting copy |
| `--text-muted` | lightest | axis/caption/placeholder |
| `--border` | 0.5px hairline | row separators, surface edges |

One neutral **accent** (blue) marks the active nav crumb, focus rings, links, and the single primary button on a screen. It never decorates.

**Why light default:** UA managers work long sessions in bright office lighting alongside spreadsheets and the Meta/GA dashboards; a light UI matches that context. Dark is a supported toggle, defined from day one so it never ships broken.

### 5.2 Band coloring — the primary data signal
Cells color on a **red → amber → green** ramp against **per-platform target bands**: three ascending boundaries, direction-aware (for CPI/eCPI lower is better, so the ramp inverts; for ROAS/retention higher is better). Built-in `DEFAULT_TARGET_BANDS` apply until the user overrides a column.

**Decisions:**
- Color the **cell background** as a soft tint, with the value in a **dark stop of the same hue** (never gray-on-color) — this keeps text legible and passes contrast in both themes.
- Tint, don't saturate. A screen full of fully-saturated red/green cells is unreadable; soft tints let the *pattern* of good/bad emerge while individual numbers stay readable.
- Bands are **direction-aware and per-column** — the same green always means "good for this metric," even though the underlying threshold differs. Consistency of *meaning* matters more than consistency of *number*.
- The `—` (incomplete) and empty cells are **never band-colored** — they carry no judgment because there's no final value to judge.

**Why this is the app's signature:** the entire value proposition is "scan a wall of daily numbers and instantly see which campaigns/days are healthy." Band coloring is that scan. It gets the color budget; everything else stays neutral so it reads.

### 5.3 Target-band editor (Settings)
Each editable column shows its three boundary inputs plus a **live preview strip** of the resulting red→green ramp, and a direction indicator (↑ higher is better / ↓ lower is better). Editing a boundary updates the preview immediately.

**Why:** Bands are abstract until you see the color they produce. A live preview turns "is 1.20 a good D7 ROAS threshold" into a visual answer and prevents mis-set bands that would mis-color the whole table.

---

## 6. The daily metrics table (`table.ts` → `CampaignView`)

This is the most important component in the app. Columns, in order: Spend, Impr., Clicks, Installs, Sess/User, CTR, IPM, **CPI**, **eCPI**, Revenue, ROAS D0/D3/D7, retention D1–D7, playtime PT D0–D3.

**Decisions:**

- **All numeric columns right-aligned, tabular figures.** Digits must align vertically so a column scans as a single quantity and doesn't shimmer when values update on sync. Non-negotiable for a data product.
- **Per-column formatting is explicit** (`format.ts`): money, integer, percent, float-1, minutes. Each column declares its formatter; a percent and a dollar never share a rule.
- **`—` for incomplete days**, rendered in muted text, never band-colored, never `0`. This is the honesty principle made visible.
- **Averages row** pinned at the bottom (or top), visually distinguished by a heavier top border and `--surface-1` background. Averages **skip `—` cells** so a partial day never drags the mean.
- **Sparklines in the column header** (Recharts), one per metric, giving the trend of that column at a glance above the exact daily values. Keep them tiny, single-hue, no axes — they're a shape, not a chart.
- **Row order: most recent day first.** The user's question is usually "how did we do lately," so today (or the latest completed day) sits at the top.
- **Column grouping.** Visually cluster related columns — acquisition (Spend/Impr/Clicks/Installs/CTR/IPM/CPI/eCPI), then monetization (Revenue/ROAS), then engagement (retention/playtime) — with a subtle group separator. The table is wide; grouping gives the eye anchors.
- **Horizontal scroll with sticky first column** (date) and sticky header. On a wide table the date and the metric labels must never scroll out of view, or a cell in the middle becomes unidentifiable.

---

## 7. Data-state design (sync honesty)

The sync pipeline is three independent sources; the UI must reflect that.

- **Completed vs. incomplete day.** A day is complete only past the 12h UTC buffer. Incomplete → `—`. Never render provisional data as final.
- **Per-source warnings.** If Meta daily, GA4 installs, or GA4 cohorts fails, show a scoped warning that **names the affected columns** ("Couldn't refresh GA4 cohorts — retention D1–D7 and ROAS may be stale"), while every other column still renders from its own source. One source failing never blanks the table.
- **Sync status affordance.** The campaign header shows `last_synced_at` and a Refresh control. `last_synced_at` is only "fresh" when all three sources succeeded; if one failed, the status reads as partial, not green.
- **Loading = skeleton, not spinner.** On first load of a table, show skeleton rows matching the final layout so it doesn't jump when data arrives.
- **Empty states are invitations.** A game with no campaigns, a campaign with no completed days yet — name the space and offer the next action ("No completed days yet. Data appears after the first day closes."). Never "Nothing here."

---

## 8. Typography

- **One sans-serif family, two weights** — 400 regular, 500 medium. Medium marks headings, active crumbs, column headers, and the Averages row; everything else regular. No 600/700 — too heavy against a dense table.
- **Tabular figures for all numbers** (see §6).
- **Sentence case everywhere** — buttons, headings, labels, menu items.
- Scale: column header 12px/500, table cell 13px/400, view title 16px/500, label/caption 12px/400 muted.

---

## 9. Spacing, corners, borders

- Spacing scale 4 / 8 / 12 / 16 / 24px. Table cells use tight padding (6–8px vertical) to fit density; view-level bands use 16–24px.
- Corner radius 8px for controls, 12px for cards. Tables themselves are square-edged inside their card.
- A single 0.5px hairline separates rows and surfaces. Elevation comes from surface lightness and hairlines — never drop shadows. Renders identically in both themes.

---

## 10. Components

**Breadcrumb.** Text crumbs separated by `/`, last crumb in `--text-primary`, ancestors in accent and clickable. This is the primary back/up mechanism.

**Metric cell.** Right-aligned, tabular, formatter-driven, optionally band-tinted background with same-hue dark text. `—` variant is muted and never tinted.

**Sparkline.** Recharts line, ~64×20px, single hue, no axes/grid/tooltip — a trend shape in the column header.

**Sync warning banner.** Amber-tinted, scoped to one source, names affected columns, dismissible-per-refresh. Not modal — the user reads the good data underneath it.

**Credential field.** Masked value, "replace" action, never re-displays the stored secret in plaintext. Reflects that secrets are `safeStorage`-encrypted at rest.

**Band editor row.** Three boundary inputs + direction indicator + live red→green preview strip (§5.3).

**Buttons.** Secondary (outline) default. At most one primary (filled accent) per screen — "New game," "Add campaign," "Refresh." Reading screens (the table) may have zero primary actions.

---

## 11. Data visualization decisions

- **Sparklines only, in-table** (Recharts) — the app's charting need is "trend of this column," which a header sparkline answers without leaving the table. No separate full charts on the campaign view; the numbers are the point.
- **Compare view** uses paired metric rows with a delta, not overlaid charts — averages compare cleanly as numbers, and band color already conveys good/bad.
- **No pies, no dual-axis, no 3D.** Excluded on legibility and data-integrity grounds.
- Sparklines are single-hue and axis-less; they show shape, not exact values (the cells beneath give exact values).

---

## 12. Interaction

- **Refresh** re-runs the sync for the current campaign; the button shows in-progress state and per-source outcome on completion.
- **Drill-down** on click: game → platforms/campaigns → campaign table. Breadcrumb climbs back up.
- **Compare** is launched from a campaign, pre-filling one side.
- **Hover** on a sparkline may reveal its latest value; hover on a band-colored cell may reveal the band it fell into (which threshold it passed/missed).
- **Keyboard**: breadcrumb, refresh, and primary actions reachable via keyboard with accent focus rings. Table is horizontally scrollable via keyboard.
- **All displayed numbers rounded to context** — integers for counts, one decimal for rates/percentages, currency formatted, minutes for playtime (per `format.ts`).

---

## 13. Accessibility

- Color is never the sole signal. Band color is paired with the visible number itself (the value carries the truth; color accelerates the scan). Deltas in Compare pair color with a direction arrow. Sync state pairs color with text.
- Band-tinted cells use the dark stop of the band's hue for text — never gray-on-color — meeting WCAG AA in both themes.
- Focus states visible on every interactive element; icon-only controls carry `aria-label`.
- Sparklines carry a text alternative summarizing their trend for screen readers.

---

## 14. Out of scope (deliberately)

Recorded so it isn't reopened:

- **Pie / donut / dual-axis charts** — rejected on legibility and integrity grounds.
- **URL router** — the state-based `route` union in `App.tsx` is sufficient for five views; a router library is unneeded weight.
- **Real-time streaming** — the data cadence is daily with a 12h completion buffer; sub-minute refresh would fight the "completed day" model.
- **Rendering provisional/incomplete data as numbers** — always `—`. Non-negotiable.
- **`.env` credentials** — credentials live in the Settings screen (`safeStorage`-encrypted); `.env` holds dev flags only (`META_FAKE`, `GA4_FAKE`, `SQLITE_PATH`).
- **Heavy theming / white-label** — one neutral accent, two themes, plus the data-driven band ramp.

---

*Note: the earlier light-theme KPI-dashboard mockup was speculative and does not match this app; the campaign daily table described in §6 is the real hero screen. This document supersedes it.*
