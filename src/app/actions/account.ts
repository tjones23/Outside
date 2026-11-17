"use server";

import type { AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { accountsDb } from "@/server/context";
import {
  AccountError,
  createSession,
  deleteUser,
  endOtherSessions,
  endSession,
  getPrefs,
  getUser,
  pruneExpired,
  putPrefs,
  countSessions,
} from "@/server/accounts";
import { allowAttempt, canSignUp, clearSessionCookie, currentUser, requestInfo, setSessionCookie } from "@/server/auth";
import {
  finishAddPasskey,
  finishSignIn,
  finishSignUp,
  listPasskeys,
  removePasskey,
  startAddPasskey,
  startSignIn,
  startSignUp,
  type Passkey,
} from "@/server/passkeys";
import { sourceLogin } from "@/lib/request-source";
import type { PrefValues } from "@/lib/synced-prefs";

/**
 * Everything the browser can ask of an account. Each action re-reads the
 * session itself (server/auth.ts) rather than trusting the page.
 */

export type AccountState =
  | { signedIn: false; secure: boolean; canSignUp: boolean }
  | {
      signedIn: true;
      username: string;
      /** This address's passkey host, so the page can say which passkeys work here. */
      host: string;
      passkeys: Passkey[];
      /** Sessions besides this one: other browsers signed in to the account. */
      otherSessions: number;
      prefs: PrefValues;
    };

export type Result = { ok: true } | { ok: false; error: string };
export type WithOptions<T> = { ok: true; options: T; challengeId: string } | { ok: false; error: string };

function failure(error: unknown): { ok: false; error: string } {
  if (error instanceof AccountError) return { ok: false, error: error.message };
  throw error;
}

export async function accountStateAction(): Promise<AccountState> {
  const current = await currentUser();
  if (!current) {
    const request = await requestInfo();
    return { signedIn: false, secure: request.secure, canSignUp: canSignUp(request) };
  }
  const db = accountsDb();
  return {
    signedIn: true,
    username: current.user.username,
    host: current.request.relyingParty.id,
    passkeys: listPasskeys(db, current.user.id),
    otherSessions: countSessions(db, current.user.id) - 1,
    prefs: getPrefs(db, current.user.id),
  };
}

// --- Making an account -------------------------------------------------------

export async function signUpOptionsAction(username: string): Promise<WithOptions<PublicKeyCredentialCreationOptionsJSON>> {
  const request = await requestInfo();
  if (!canSignUp(request)) {
    return { ok: false, error: request.secure ? "Accounts can only be made from the tailnet." : "Passkeys need the HTTPS address." };
  }
  if (!allowAttempt("sign-up", request)) return { ok: false, error: "Too many tries. Wait 15 minutes." };
  try {
    const { options, challengeId } = await startSignUp(accountsDb(), String(username ?? ""), request.relyingParty, Date.now());
    return { ok: true, options, challengeId };
  } catch (error) {
    return failure(error);
  }
}

export async function signUpAction(challengeId: string, response: RegistrationResponseJSON, passkeyLabel: string): Promise<Result> {
  const request = await requestInfo();
  if (!canSignUp(request)) return { ok: false, error: "Accounts can only be made from the tailnet." };
  const db = accountsDb();
  const now = Date.now();
  try {
    const userId = await finishSignUp(
      db,
      String(challengeId ?? ""),
      response,
      request.relyingParty,
      String(passkeyLabel ?? ""),
      sourceLogin(request.source),
      now,
    );
    await startSession(userId, request.userAgent, request.https, now);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

// --- Signing in and out --------------------------------------------------------

export async function signInOptionsAction(): Promise<WithOptions<PublicKeyCredentialRequestOptionsJSON>> {
  const request = await requestInfo();
  if (!request.secure) return { ok: false, error: "Passkeys need the HTTPS address." };
  const { options, challengeId } = await startSignIn(accountsDb(), request.relyingParty, Date.now());
  return { ok: true, options, challengeId };
}

export async function signInAction(challengeId: string, response: AuthenticationResponseJSON): Promise<Result> {
  const request = await requestInfo();
  if (!allowAttempt("sign-in", request)) return { ok: false, error: "Too many tries. Wait 15 minutes and try again." };
  const db = accountsDb();
  const now = Date.now();
  const userId = await finishSignIn(db, String(challengeId ?? ""), response, request.relyingParty, now);
  if (userId === null || !getUser(db, userId)) {
    return { ok: false, error: "That passkey isn't one Outside knows at this address." };
  }
  await startSession(userId, request.userAgent, request.https, now);
  return { ok: true };
}

/** A previous session on this browser is replaced, not stacked. */
async function startSession(userId: number, userAgent: string | null, https: boolean, now: number) {
  const db = accountsDb();
  const previous = await currentUser();
  if (previous) endSession(db, previous.session.idHash);
  pruneExpired(db, now);
  await setSessionCookie(createSession(db, userId, userAgent, now), https);
}

export async function signOutAction(): Promise<Result> {
  const current = await currentUser();
  if (current) endSession(accountsDb(), current.session.idHash);
  await clearSessionCookie();
  return { ok: true };
}

/** Signs out every other browser, keeping this one. */
export async function signOutOthersAction(): Promise<Result> {
  const current = await currentUser();
  if (!current) return { ok: false, error: "You're signed out." };
  endOtherSessions(accountsDb(), current.user.id, current.session.idHash);
  return { ok: true };
}

export async function deleteAccountAction(confirmUsername: string): Promise<Result> {
  const current = await currentUser();
  if (!current) return { ok: false, error: "You're signed out." };
  if (String(confirmUsername ?? "").trim().toLowerCase() !== current.user.username) {
    return { ok: false, error: `Type ${current.user.username} to confirm.` };
  }
  deleteUser(accountsDb(), current.user.id);
  await clearSessionCookie();
  return { ok: true };
}

// --- Passkeys, signed in ---------------------------------------------------------

export async function addPasskeyOptionsAction(): Promise<WithOptions<PublicKeyCredentialCreationOptionsJSON>> {
  const current = await currentUser();
  if (!current) return { ok: false, error: "You're signed out." };
  if (!allowAttempt("add-passkey", current.request)) return { ok: false, error: "Too many tries. Wait 15 minutes." };
  const options = await startAddPasskey(accountsDb(), current.session, current.user, current.request.relyingParty, Date.now());
  return { ok: true, options, challengeId: "" };
}

export async function addPasskeyAction(response: RegistrationResponseJSON, name: string): Promise<Result> {
  const current = await currentUser();
  if (!current) return { ok: false, error: "You're signed out." };
  try {
    await finishAddPasskey(accountsDb(), current.session, response, current.request.relyingParty, String(name ?? ""), Date.now());
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function removePasskeyAction(id: number): Promise<Result> {
  const current = await currentUser();
  if (!current) return { ok: false, error: "You're signed out." };
  try {
    removePasskey(accountsDb(), current.user.id, Number(id));
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

// --- Preferences ---------------------------------------------------------------

/** Saves the given preferences to the account. `signedOut` tells the browser to stop syncing. */
export async function savePrefsAction(values: PrefValues): Promise<{ ok: true } | { ok: false; signedOut: boolean }> {
  const current = await currentUser();
  if (!current) return { ok: false, signedOut: true };
  putPrefs(accountsDb(), current.user.id, values, Date.now());
  return { ok: true };
}
