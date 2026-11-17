import type { DatabaseSync } from "node:sqlite";
import { transaction } from "./db";
import { hashToken, newToken } from "@/lib/tokens";
import { cleanPrefValues, type PrefValues } from "@/lib/synced-prefs";

/**
 * Accounts, sessions and preferences. No passwords: an account is made with
 * a passkey and signed into with one (server/passkeys.ts).
 *
 * Every function takes the database and `now`, so tests run on an in-memory
 * database with a fixed clock.
 */

/** A problem worth showing the person, as opposed to a bug. */
export class AccountError extends Error {}

export interface User {
  id: number;
  username: string;
  createdAt: number;
}

export interface Session {
  idHash: string;
  userId: number;
  createdAt: number;
  lastSeenAt: number;
}

// ---------------------------------------------------------------------------
// How long a sign-in lasts. Outside holds saved places and map settings, not
// money, and signing back in takes a touch of Face ID — so sessions are long.
// ---------------------------------------------------------------------------

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/** Signed out after this long without a visit. */
export const IDLE_TIMEOUT_MS = 90 * DAY;
/** Signed out this long after signing in, however active. */
export const ABSOLUTE_TIMEOUT_MS = 365 * DAY;
/** `last_seen_at` is only written back this often, not on every request. */
export const TOUCH_INTERVAL_MS = HOUR;

export function sessionExpired(s: Pick<Session, "createdAt" | "lastSeenAt">, now: number): boolean {
  return now - s.createdAt > ABSOLUTE_TIMEOUT_MS || now - s.lastSeenAt > IDLE_TIMEOUT_MS;
}

/** The cookie's own Max-Age: never longer than the session could live. */
export function cookieMaxAgeSeconds(s: Pick<Session, "createdAt" | "lastSeenAt">, now: number): number {
  const end = Math.min(s.lastSeenAt + IDLE_TIMEOUT_MS, s.createdAt + ABSOLUTE_TIMEOUT_MS);
  return Math.max(0, Math.floor((end - now) / 1000));
}

// ---------------------------------------------------------------------------
// Usernames: shown in the passkey picker, so people can tell accounts apart.
// ---------------------------------------------------------------------------

export function normalizeUsername(name: string): string {
  return name.trim().toLowerCase();
}

export function usernameProblem(name: string): string | null {
  if (!/^[a-z0-9._-]{3,32}$/.test(name)) return "3–32 characters: letters, numbers, dots, dashes or underscores.";
  return null;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

function toUser(row: Record<string, unknown> | undefined): User | null {
  if (!row) return null;
  return { id: row.id as number, username: row.username as string, createdAt: row.created_at as number };
}

export function getUser(db: DatabaseSync, id: number): User | null {
  return toUser(db.prepare("SELECT id, username, created_at FROM users WHERE id = ?").get(id));
}

export function findUserByName(db: DatabaseSync, username: string): User | null {
  return toUser(db.prepare("SELECT id, username, created_at FROM users WHERE username = ?").get(normalizeUsername(username)));
}

export function usernameTaken(db: DatabaseSync, username: string): boolean {
  return findUserByName(db, username) !== null;
}

export function listUsers(db: DatabaseSync): (User & { passkeys: number; createdByLogin: string | null })[] {
  return db
    .prepare(
      `SELECT u.id, u.username, u.created_at, u.created_by_login, COUNT(p.id) AS passkeys
       FROM users u LEFT JOIN passkeys p ON p.user_id = u.id GROUP BY u.id ORDER BY u.created_at`,
    )
    .all()
    .map((r) => ({
      ...toUser(r)!,
      passkeys: r.passkeys as number,
      createdByLogin: (r.created_by_login as string | null) ?? null,
    }));
}

/** Throws AccountError if the name is taken. Callers check `usernameProblem` first. */
export function createUser(
  db: DatabaseSync,
  username: string,
  userHandle: string,
  createdByLogin: string | null,
  now: number,
): number {
  try {
    return Number(
      db
        .prepare("INSERT INTO users (username, user_handle, created_by_login, created_at) VALUES (?, ?, ?, ?)")
        .run(normalizeUsername(username), userHandle, createdByLogin, now).lastInsertRowid,
    );
  } catch {
    throw new AccountError("That name is taken — pick another.");
  }
}

/** Everything goes with it: passkeys, sessions, preferences (ON DELETE CASCADE). */
export function deleteUser(db: DatabaseSync, userId: number) {
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/** Returns the cookie value; only its hash is stored. */
export function createSession(db: DatabaseSync, userId: number, userAgent: string | null, now: number): string {
  const token = newToken();
  db.prepare("INSERT INTO sessions (id_hash, user_id, created_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?)").run(
    hashToken(token),
    userId,
    now,
    now,
    userAgent?.slice(0, 300) ?? null,
  );
  return token;
}

/** The live session and its user for a cookie value, or null. An expired one is deleted. */
export function findSession(db: DatabaseSync, token: string, now: number): { session: Session; user: User } | null {
  const idHash = hashToken(token);
  const row = db.prepare("SELECT user_id, created_at, last_seen_at FROM sessions WHERE id_hash = ?").get(idHash) as
    | { user_id: number; created_at: number; last_seen_at: number }
    | undefined;
  if (!row) return null;
  const session: Session = { idHash, userId: row.user_id, createdAt: row.created_at, lastSeenAt: row.last_seen_at };
  if (sessionExpired(session, now)) {
    endSession(db, idHash);
    return null;
  }
  const user = getUser(db, session.userId);
  if (!user) return null;
  if (now - session.lastSeenAt > TOUCH_INTERVAL_MS) {
    db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?").run(now, idHash);
    session.lastSeenAt = now;
  }
  return { session, user };
}

export function endSession(db: DatabaseSync, idHash: string) {
  db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(idHash);
}

/** Signs an account out everywhere but (optionally) one session. */
export function endOtherSessions(db: DatabaseSync, userId: number, keepIdHash: string | null): number {
  return Number(db.prepare("DELETE FROM sessions WHERE user_id = ? AND id_hash IS NOT ?").run(userId, keepIdHash).changes);
}

export function countSessions(db: DatabaseSync, userId: number): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?").get(userId) as { n: number }).n;
}

/** Clears out sessions and sign-in challenges nobody can use any more. */
export function pruneExpired(db: DatabaseSync, now: number) {
  db.prepare("DELETE FROM sessions WHERE created_at < ? OR last_seen_at < ?").run(now - ABSOLUTE_TIMEOUT_MS, now - IDLE_TIMEOUT_MS);
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export function getPrefs(db: DatabaseSync, userId: number): PrefValues {
  const out: PrefValues = {};
  for (const row of db.prepare("SELECT key, value FROM preferences WHERE user_id = ?").all(userId)) {
    out[row.key as string] = row.value as string;
  }
  // Re-cleaned on the way out too, so a key retired in a later version is never sent back.
  return cleanPrefValues(out);
}

/** Stores the valid entries of `values`, last write winning; returns what was stored. */
export function putPrefs(db: DatabaseSync, userId: number, values: unknown, now: number): PrefValues {
  const clean = cleanPrefValues(values);
  const upsert = db.prepare(
    `INSERT INTO preferences (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  transaction(db, () => {
    for (const [key, value] of Object.entries(clean)) upsert.run(userId, key, value, now);
  });
  return clean;
}
