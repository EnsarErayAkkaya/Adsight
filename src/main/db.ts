import { drizzle, BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import { app } from "electron";
import { existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import * as schema from "./schema";

type DB = BetterSQLite3Database<typeof schema>;

let _db: DB | undefined;

function dbPath(): string {
  if (process.env.SQLITE_PATH) return process.env.SQLITE_PATH;
  // Dev: keep the DB inside the repo; packaged: per-user app data.
  return app.isPackaged
    ? join(app.getPath("userData"), "app.db")
    : join(app.getAppPath(), "data", "app.db");
}

function migrationsDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "drizzle")
    : join(app.getAppPath(), "drizzle");
}

export function getDb(): DB {
  if (!_db) {
    const path = dbPath();
    mkdirSync(dirname(path), { recursive: true });
    const sqlite = new Database(path);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    _db = drizzle(sqlite, { schema });

    const dir = migrationsDir();
    if (existsSync(dir)) {
      migrate(_db, { migrationsFolder: dir });
    }
  }
  return _db;
}

export const db: DB = new Proxy({} as DB, {
  get(_target, prop) {
    return Reflect.get(getDb(), prop);
  },
});
