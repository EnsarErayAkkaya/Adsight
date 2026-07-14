import { app, BrowserWindow, shell } from "electron";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import { registerIpcHandlers } from "./ipc";
import { getDb } from "./db";

// Dev flags only (META_FAKE/GA4_FAKE, SQLITE_PATH). Credentials live in the
// Settings screen (encrypted in the DB), never in .env.
loadEnv({
  path: app.isPackaged
    ? join(app.getPath("userData"), ".env")
    : join(app.getAppPath(), ".env"),
});

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    autoHideMenuBar: true,
    // Packaged builds take the window/taskbar icon from the exe (see
    // electron-builder.yml); this covers dev, where public/ isn't bundled.
    ...(app.isPackaged
      ? {}
      : { icon: join(app.getAppPath(), "public", "adsight.png") }),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  // External links open in the system browser, not the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

/** Headless self-test (SMOKE_TEST=1): exercises DB, sync and table assembly. */
async function smokeTest(): Promise<void> {
  const { randomUUID } = await import("crypto");
  const { db } = await import("./db");
  const { game, platform, campaign } = await import("./schema");
  const { getCampaignTable } = await import("./table");

  const gameId = randomUUID();
  const platformId = randomUUID();
  const campaignId = randomUUID();
  await db.insert(game).values({
    id: gameId,
    name: "Smoke Game",
    ga4PropertyId: "123456789",
  });
  await db.insert(platform).values({
    id: platformId,
    gameId,
    platform: "ios",
  });
  await db.insert(campaign).values({
    id: campaignId,
    platformId,
    name: "Smoke Campaign",
    metaCampaignId: "120210000000000001",
    startDate: "2026-07-05",
    endDate: "2026-07-15",
  });

  // Unique-platform rule: a second iOS row for the same game must fail.
  let duplicateRejected = false;
  try {
    await db.insert(platform).values({
      id: randomUUID(),
      gameId,
      platform: "ios",
    });
  } catch {
    duplicateRejected = true;
  }
  console.log(`[smoke] duplicate platform rejected=${duplicateRejected}`);

  // Same property, different platform → different fake GA4 data.
  const { fetchGa4DailyInstalls } = await import("./ga4");
  const ios = await fetchGa4DailyInstalls("123456789", "ios", [], "2026-07-05", "2026-07-05");
  const android = await fetchGa4DailyInstalls("123456789", "android", [], "2026-07-05", "2026-07-05");
  const usOnly = await fetchGa4DailyInstalls("123456789", "ios", ["US"], "2026-07-05", "2026-07-05");
  console.log(
    `[smoke] installs ios=${ios[0].installs} android=${android[0].installs} ` +
      `differ=${ios[0].installs !== android[0].installs} ` +
      `countryScoped=${usOnly[0].installs !== ios[0].installs}`,
  );

  const table = await getCampaignTable(campaignId);
  if (!table) throw new Error("table not returned");
  const filled = table.rows.filter((r) => r.cells[0] !== null);
  console.log(`[smoke] columns=${table.columns.length} rows=${table.rows.length}`);
  console.log(`[smoke] rows with spend=${filled.length} sync=${JSON.stringify(table.sync)}`);
  console.log(`[smoke] first filled row:`, JSON.stringify(filled[0]));
  console.log(`[smoke] averages:`, JSON.stringify(table.averages));

  // Global target bands: set for iOS, verify the campaign table carries them.
  const { setTargetBands, getTargetBands } = await import("./settings");
  const bandsBefore = await getTargetBands("ios");
  await setTargetBands("ios", {
    eCPI: { low: 1, mid: 1.5, high: 2 },
    D1: { low: 0.2, mid: 0.3, high: 0.4 },
  });
  const table2 = await getCampaignTable(campaignId);
  console.log(
    `[smoke] bands on table: ${JSON.stringify(table2!.bands)} ` +
      `(expect eCPI + D1 bands)`,
  );
  let orderRejected = false;
  try {
    await setTargetBands("ios", { eCPI: { low: 2, mid: 1, high: 3 } });
  } catch {
    orderRejected = true;
  }
  console.log(`[smoke] unordered band rejected=${orderRejected}`);
  await setTargetBands("ios", bandsBefore);

  // Settings round-trip (safeStorage-encrypted secret + plain value).
  // Snapshot the real stored rows first and restore them afterwards.
  const { updateSettings, getSettingsInfo, getMetaCredentials } = await import(
    "./settings"
  );
  const { setting, metaDaily } = await import("./schema");
  const { eq, inArray } = await import("drizzle-orm");
  const SMOKE_KEYS = ["metaAccessToken", "metaAdAccountId"];
  const savedRows = await db
    .select()
    .from(setting)
    .where(inArray(setting.key, SMOKE_KEYS));

  await updateSettings({
    metaAccessToken: "smoke-token-123",
    metaAdAccountId: "act_42",
  });
  const creds = await getMetaCredentials();
  const settingsInfo = await getSettingsInfo();
  console.log(
    `[smoke] settings: token roundtrip=${creds.token === "smoke-token-123"} ` +
      `account=${creds.account} encrypted=${settingsInfo.encryptionAvailable}`,
  );

  await db.delete(setting).where(inArray(setting.key, SMOKE_KEYS));
  for (const row of savedRows) {
    await db.insert(setting).values(row);
  }

  // Changing a campaign's Meta ID must wipe its stored meta_daily rows.
  const { updateCampaign } = await import("./ipc");
  const rowsBefore = (
    await db.select().from(metaDaily).where(eq(metaDaily.campaignId, campaignId))
  ).length;
  await updateCampaign({
    id: campaignId,
    name: "Smoke Campaign (edited)",
    metaCampaignId: "120210000000000099",
    startDate: "2026-07-05",
    endDate: "2026-07-15",
    countries: [],
  });
  const rowsAfter = (
    await db.select().from(metaDaily).where(eq(metaDaily.campaignId, campaignId))
  ).length;
  console.log(
    `[smoke] edit wipe: meta rows ${rowsBefore} -> ${rowsAfter} (expect 0)`,
  );

  // Changing countries must wipe stored GA4 data (fetched with old scope).
  const { ga4Installs } = await import("./schema");
  const installsBefore = (
    await db.select().from(ga4Installs).where(eq(ga4Installs.campaignId, campaignId))
  ).length;
  await updateCampaign({
    id: campaignId,
    name: "Smoke Campaign (edited)",
    metaCampaignId: "120210000000000099",
    startDate: "2026-07-05",
    endDate: "2026-07-15",
    countries: ["US", "CA"],
  });
  const installsAfter = (
    await db.select().from(ga4Installs).where(eq(ga4Installs.campaignId, campaignId))
  ).length;
  console.log(
    `[smoke] country wipe: ga4 install rows ${installsBefore} -> ${installsAfter} (expect >0 -> 0)`,
  );

  await db.delete(game).where(eq(game.id, gameId));
  console.log("[smoke] OK");
}

app.whenReady().then(async () => {
  getDb(); // open DB + run migrations before any IPC arrives

  if (process.env.SMOKE_TEST === "1") {
    try {
      await smokeTest();
      app.exit(0);
    } catch (err) {
      console.error("[smoke] FAILED:", err);
      app.exit(1);
    }
    return;
  }

  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
