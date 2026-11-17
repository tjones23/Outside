import type { DatabaseSync } from "node:sqlite";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { AccountError, createUser, normalizeUsername, usernameProblem, usernameTaken, type Session, type User } from "./accounts";
import { transaction } from "./db";
import type { RelyingParty } from "@/lib/request-source";
import { hashToken, newToken } from "@/lib/tokens";

/**
 * Passkeys (WebAuthn) — the only way into an Outside account, the same way
 * MoneyRight's passkey sign-in works: no username, no password. A passkey is
 * something you have (the device, or a synced keychain) unlocked by
 * something you are or know (Face ID, Touch ID, the device passcode). User
 * verification is required, and it can't be phished: the browser only offers
 * it to the host it was made on.
 *
 * A passkey belongs to that host (the relying party ID): one made at
 * outside.<tailnet>.ts.net doesn't work at localhost, and the reverse — so
 * only the current host's passkeys are offered. Browsers only allow passkeys
 * on a secure page, so the plain-HTTP LAN address has none.
 *
 * Challenges are spent by the first attempt to use them and last five
 * minutes. Before there's a session (signing in, making an account) they're
 * kept under a random id the browser holds until it answers; while adding a
 * passkey, on the session row.
 */

const CHALLENGE_TTL_MS = 5 * 60_000;
const RP_NAME = "Outside";

export interface Passkey {
  id: number;
  name: string;
  rpId: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export function listPasskeys(db: DatabaseSync, userId: number): Passkey[] {
  return db
    .prepare("SELECT id, name, rp_id, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at")
    .all(userId)
    .map((r) => ({
      id: r.id as number,
      name: r.name as string,
      rpId: r.rp_id as string,
      createdAt: r.created_at as number,
      lastUsedAt: (r.last_used_at as number | null) ?? null,
    }));
}

function credentialsFor(db: DatabaseSync, userId: number, rpId: string) {
  return db
    .prepare("SELECT credential_id, public_key, counter, transports FROM passkeys WHERE user_id = ? AND rp_id = ?")
    .all(userId, rpId)
    .map((r) => ({
      id: r.credential_id as string,
      publicKey: new Uint8Array(r.public_key as Uint8Array),
      counter: r.counter as number,
      transports: r.transports ? (JSON.parse(r.transports as string) as string[]) : undefined,
    }));
}

function passkeyName(name: string): string {
  return name.trim().slice(0, 60) || "Passkey";
}

function userHandleOf(db: DatabaseSync, userId: number): string {
  return (db.prepare("SELECT user_handle FROM users WHERE id = ?").get(userId) as { user_handle: string }).user_handle;
}

function registrationOptions(rp: RelyingParty, username: string, userHandle: string, exclude: { id: string; transports?: string[] }[]) {
  return generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.id,
    userName: username,
    userDisplayName: username,
    userID: new TextEncoder().encode(userHandle),
    attestationType: "none",
    excludeCredentials: exclude.map((c) => ({ id: c.id, transports: c.transports as never })),
    // Discoverable, so it signs in on its own, without a username first.
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
}

/** Verifies a registration; the credential to store, or an AccountError. */
async function verifyNewPasskey(response: RegistrationResponseJSON, challenge: string, rp: RelyingParty) {
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      requireUserVerification: true,
    });
  } catch {
    throw new AccountError("That passkey couldn't be verified.");
  }
  if (!verification.verified) throw new AccountError("That passkey couldn't be verified.");
  return verification.registrationInfo.credential;
}

function storePasskey(
  db: DatabaseSync,
  userId: number,
  credential: Awaited<ReturnType<typeof verifyNewPasskey>>,
  rp: RelyingParty,
  name: string,
  now: number,
) {
  try {
    db.prepare(
      "INSERT INTO passkeys (user_id, credential_id, public_key, counter, transports, rp_id, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      userId,
      credential.id,
      Buffer.from(credential.publicKey),
      credential.counter,
      credential.transports ? JSON.stringify(credential.transports) : null,
      rp.id,
      passkeyName(name),
      now,
    );
  } catch {
    throw new AccountError("That passkey is already added.");
  }
}

// ---------------------------------------------------------------------------
// Challenges with no session yet
// ---------------------------------------------------------------------------

type Purpose = "sign-in" | "sign-up";

interface PendingChallenge {
  challenge: string;
  username: string | null;
  userHandle: string | null;
}

function issueChallenge(
  db: DatabaseSync,
  purpose: Purpose,
  challenge: string,
  rp: RelyingParty,
  now: number,
  pending: { username?: string; userHandle?: string } = {},
): string {
  db.prepare("DELETE FROM passkey_challenges WHERE created_at < ?").run(now - CHALLENGE_TTL_MS);
  const challengeId = newToken();
  db.prepare(
    "INSERT INTO passkey_challenges (id_hash, purpose, challenge, rp_id, username, user_handle, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(hashToken(challengeId), purpose, challenge, rp.id, pending.username ?? null, pending.userHandle ?? null, now);
  return challengeId;
}

/** The challenge, if it's fresh and was issued for this purpose and host — and spent either way. */
function takeChallenge(db: DatabaseSync, challengeId: string, purpose: Purpose, rp: RelyingParty, now: number): PendingChallenge | null {
  const idHash = hashToken(String(challengeId));
  const row = db
    .prepare("SELECT purpose, challenge, rp_id, username, user_handle, created_at FROM passkey_challenges WHERE id_hash = ?")
    .get(idHash) as
    | { purpose: string; challenge: string; rp_id: string; username: string | null; user_handle: string | null; created_at: number }
    | undefined;
  db.prepare("DELETE FROM passkey_challenges WHERE id_hash = ?").run(idHash);
  if (!row || row.purpose !== purpose || row.rp_id !== rp.id || now - row.created_at > CHALLENGE_TTL_MS) return null;
  return { challenge: row.challenge, username: row.username, userHandle: row.user_handle };
}

// ---------------------------------------------------------------------------
// Making an account: a name, then its first passkey
// ---------------------------------------------------------------------------

export async function startSignUp(db: DatabaseSync, rawUsername: string, rp: RelyingParty, now: number) {
  const username = normalizeUsername(String(rawUsername ?? ""));
  const problem = usernameProblem(username);
  if (problem) throw new AccountError(problem);
  if (usernameTaken(db, username)) throw new AccountError("That name is taken — pick another.");
  // Random, not the username or row id: it's stored on the passkey, and
  // shouldn't say anything about the account.
  const userHandle = newToken();
  const options = await registrationOptions(rp, username, userHandle, []);
  const challengeId = issueChallenge(db, "sign-up", options.challenge, rp, now, { username, userHandle });
  return { options, challengeId };
}

/** Makes the account with this passkey; returns its id. */
export async function finishSignUp(
  db: DatabaseSync,
  challengeId: string,
  response: RegistrationResponseJSON,
  rp: RelyingParty,
  passkeyLabel: string,
  createdByLogin: string | null,
  now: number,
): Promise<number> {
  const pending = takeChallenge(db, challengeId, "sign-up", rp, now);
  if (!pending?.username || !pending.userHandle) throw new AccountError("That took too long — try again.");
  const credential = await verifyNewPasskey(response, pending.challenge, rp);
  return transaction(db, () => {
    const userId = createUser(db, pending.username!, pending.userHandle!, createdByLogin, now);
    storePasskey(db, userId, credential, rp, passkeyLabel, now);
    return userId;
  });
}

// ---------------------------------------------------------------------------
// Signing in: whichever passkey the browser offers
// ---------------------------------------------------------------------------

export async function startSignIn(db: DatabaseSync, rp: RelyingParty, now: number) {
  // No allowCredentials: the browser lists every passkey it has for this host.
  const options = await generateAuthenticationOptions({ rpID: rp.id, userVerification: "required" });
  return { options, challengeId: issueChallenge(db, "sign-in", options.challenge, rp, now) };
}

/** The user a passkey signed in, or null. */
export async function finishSignIn(
  db: DatabaseSync,
  challengeId: string,
  response: AuthenticationResponseJSON,
  rp: RelyingParty,
  now: number,
): Promise<number | null> {
  const pending = takeChallenge(db, challengeId, "sign-in", rp, now);
  if (!pending) return null;

  const owner = db
    .prepare("SELECT user_id FROM passkeys WHERE credential_id = ? AND rp_id = ?")
    .get(String(response?.id ?? ""), rp.id) as { user_id: number } | undefined;
  if (!owner) return null;
  // The passkey names its account too; it must be the one the credential belongs to.
  const handle = response.response?.userHandle;
  if (handle && Buffer.from(handle, "base64url").toString() !== userHandleOf(db, owner.user_id)) return null;

  const credential = credentialsFor(db, owner.user_id, rp.id).find((c) => c.id === response.id);
  if (!credential) return null;
  try {
    const { verified, authenticationInfo } = await verifyAuthenticationResponse({
      response,
      expectedChallenge: pending.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      credential: credential as never,
      requireUserVerification: true,
    });
    if (!verified) return null;
    db.prepare("UPDATE passkeys SET counter = ?, last_used_at = ? WHERE credential_id = ? AND user_id = ?").run(
      authenticationInfo.newCounter,
      now,
      credential.id,
      owner.user_id,
    );
    return owner.user_id;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Adding another (signed in): a second device, or this account at another address
// ---------------------------------------------------------------------------

export async function startAddPasskey(db: DatabaseSync, session: Session, user: User, rp: RelyingParty, now: number) {
  const options = await registrationOptions(rp, user.username, userHandleOf(db, user.id), credentialsFor(db, user.id, rp.id));
  db.prepare("UPDATE sessions SET webauthn_challenge = ?, webauthn_challenge_at = ? WHERE id_hash = ?").run(
    options.challenge,
    now,
    session.idHash,
  );
  return options;
}

export async function finishAddPasskey(
  db: DatabaseSync,
  session: Session,
  response: RegistrationResponseJSON,
  rp: RelyingParty,
  name: string,
  now: number,
) {
  const row = db
    .prepare("SELECT webauthn_challenge, webauthn_challenge_at FROM sessions WHERE id_hash = ?")
    .get(session.idHash) as { webauthn_challenge: string | null; webauthn_challenge_at: number | null } | undefined;
  db.prepare("UPDATE sessions SET webauthn_challenge = NULL, webauthn_challenge_at = NULL WHERE id_hash = ?").run(session.idHash);
  if (!row?.webauthn_challenge || !row.webauthn_challenge_at || now - row.webauthn_challenge_at > CHALLENGE_TTL_MS) {
    throw new AccountError("That took too long — try adding the passkey again.");
  }
  const credential = await verifyNewPasskey(response, row.webauthn_challenge, rp);
  storePasskey(db, session.userId, credential, rp, name, now);
}

/** An account always keeps at least one passkey — without one it could never be signed into again. */
export function removePasskey(db: DatabaseSync, userId: number, id: number) {
  transaction(db, () => {
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?").get(userId) as { n: number };
    const mine = db.prepare("SELECT 1 FROM passkeys WHERE id = ? AND user_id = ?").get(id, userId);
    if (!mine) return;
    if (n <= 1) throw new AccountError("That's this account's only passkey. Add another first, or delete the account.");
    db.prepare("DELETE FROM passkeys WHERE id = ? AND user_id = ?").run(id, userId);
  });
}
