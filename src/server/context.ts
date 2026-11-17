import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { migrate, openDatabase } from "./db";

/**
 * Where accounts live, and the one open database.
 *
 *   .outside/accounts/production/   what `next start` uses
 *   .outside/accounts/development/  what `next dev` uses — so trying things
 *                                   out never touches real accounts
 *
 * `OUTSIDE_DATA_DIR` overrides it. The directory is gitignored (all of
 * `.outside/` is) and owner-only. (The turbopackIgnore comments tell the build
 * these paths are data, not source, so it doesn't trace the project into the
 * server output.)
 */

export type Environment = "production" | "development";

export function currentEnvironment(): Environment {
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

export function defaultDataDir(env: Environment): string {
  return join(process.cwd(), ".outside", "accounts", env);
}

export function dataDir(): string {
  return process.env.OUTSIDE_DATA_DIR || defaultDataDir(currentEnvironment());
}

export function openAccountsDatabase(dir: string): DatabaseSync {
  mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true, mode: 0o700 });
  chmodSync(/*turbopackIgnore: true*/ dir, 0o700);
  const path = join(dir, "outside.db");
  const db = openDatabase(path);
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(/*turbopackIgnore: true*/ path + suffix)) chmodSync(/*turbopackIgnore: true*/ path + suffix, 0o600);
  }
  return db;
}

// One per server process. Kept on globalThis so dev-mode hot reloads reuse it
// instead of opening the file again on every edit.
const globalForDb = globalThis as unknown as { __outsideAccounts?: DatabaseSync };

export function accountsDb(): DatabaseSync {
  const existing = globalForDb.__outsideAccounts;
  if (!existing) return (globalForDb.__outsideAccounts = openAccountsDatabase(dataDir()));
  // A hot reload can bring new migrations into a database opened before them.
  if (process.env.NODE_ENV === "development") migrate(existing);
  return existing;
}
