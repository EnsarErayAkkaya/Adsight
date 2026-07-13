import { app, BrowserWindow, shell } from "electron";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import { registerIpcHandlers } from "./ipc";
import { getDb } from "./db";

// Secrets (Meta token, GA4 service account, *_FAKE flags). Dev: repo .env;
// packaged: <userData>/.env so users can configure without rebuilding.
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
  const ios = await fetchGa4DailyInstalls("123456789", "ios", "2026-07-05", "2026-07-05");
  const android = await fetchGa4DailyInstalls("123456789", "android", "2026-07-05", "2026-07-05");
  console.log(
    `[smoke] installs ios=${ios[0].installs} android=${android[0].installs} differ=${ios[0].installs !== android[0].installs}`,
  );

  const table = await getCampaignTable(campaignId);
  if (!table) throw new Error("table not returned");
  const filled = table.rows.filter((r) => r.cells[0] !== null);
  console.log(`[smoke] columns=${table.columns.length} rows=${table.rows.length}`);
  console.log(`[smoke] rows with spend=${filled.length} sync=${JSON.stringify(table.sync)}`);
  console.log(`[smoke] first filled row:`, JSON.stringify(filled[0]));
  console.log(`[smoke] averages:`, JSON.stringify(table.averages));

  await db.delete(game).where((await import("drizzle-orm")).eq(game.id, gameId));
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
