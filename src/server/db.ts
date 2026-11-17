import { DatabaseSync } from "node:sqlite";

/**
 * The accounts database, through Node's built-in `node:sqlite` — synchronous,
 * no native add-on, one file. It holds accounts, their passkeys and sessions,
 * and each account's preferences; every weather feed stays in Next's cache.
 *
 * Migrations are an ordered list, applied in a transaction each and counted
 * in `PRAGMA user_version`. Never edit one that has shipped — add the next.
 */

const MIGRATIONS: string[] = [
  // 1: accounts, passkeys, sessions, preferences.
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    -- The WebAuthn user handle: random, never shown, never changes.
    user_handle TEXT NOT NULL UNIQUE,
    -- The tailnet login that made the account, or null if made on this Mac.
    created_by_login TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE passkeys (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- base64url credential id, from the authenticator.
    credential_id TEXT NOT NULL UNIQUE,
    public_key BLOB NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT,
    -- The host it was made on: a passkey for the tailnet name doesn't work on localhost.
    rp_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
  );
  CREATE INDEX passkeys_user ON passkeys(user_id);

  CREATE TABLE sessions (
    -- SHA-256 of the cookie value; the value itself is never stored.
    id_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    user_agent TEXT,
    -- The WebAuthn challenge in flight for adding a passkey, and when it was issued.
    webauthn_challenge TEXT,
    webauthn_challenge_at INTEGER
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  -- Challenges for signing in or creating an account, before any session exists.
  CREATE TABLE passkey_challenges (
    id_hash TEXT PRIMARY KEY,
    purpose TEXT NOT NULL CHECK (purpose IN ('sign-in', 'sign-up')),
    challenge TEXT NOT NULL,
    rp_id TEXT NOT NULL,
    -- For sign-up: the username and user handle the new passkey was made for.
    username TEXT,
    user_handle TEXT,
    created_at INTEGER NOT NULL
  );

  -- One row per stored preference (see lib/synced-prefs.ts), value as JSON.
  CREATE TABLE preferences (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, key)
  );
  `,
];

export function migrate(db: DatabaseSync) {
  const { user_version: version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let i = version; i < MIGRATIONS.length; i++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    });
  }
}

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  migrate(db);
  return db;
}

/** Runs `fn` in a transaction, rolled back if it throws. Not re-entrant. */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
