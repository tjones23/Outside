import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "./db";
import { AccountError, createSession, deleteUser, findSession, getUser, putPrefs } from "./accounts";
import {
  finishAddPasskey,
  finishSignIn,
  finishSignUp,
  listPasskeys,
  removePasskey,
  startAddPasskey,
  startSignIn,
  startSignUp,
} from "./passkeys";
import { SoftAuthenticator } from "./soft-authenticator";

const T0 = Date.UTC(2026, 10, 17, 18);
const rp = { id: "localhost", origin: "http://localhost:3001" };
const tailnet = { id: "outside.example.ts.net", origin: "https://outside.example.ts.net" };
let db: DatabaseSync;

beforeEach(() => {
  db = openDatabase(":memory:");
});

async function signUp(username = "alex", at = rp, device = new SoftAuthenticator()) {
  const { options, challengeId } = await startSignUp(db, username, at, T0);
  const userId = await finishSignUp(db, challengeId, device.register(options, at), at, "Mac", "alex@example.com", T0);
  return { userId, device };
}

async function signIn(device: SoftAuthenticator, at = rp, now = T0) {
  const { options, challengeId } = await startSignIn(db, at, now);
  return finishSignIn(db, challengeId, device.authenticate(options, at), at, now);
}

describe("making an account", () => {
  it("makes the account and its first passkey, then signs in with it alone", async () => {
    const { userId, device } = await signUp(" Alex ");
    expect(getUser(db, userId)?.username).toBe("alex");
    expect(listPasskeys(db, userId).map((p) => [p.name, p.rpId])).toEqual([["Mac", "localhost"]]);
    expect(await signIn(device)).toBe(userId);
    expect(listPasskeys(db, userId)[0].lastUsedAt).toBe(T0);
  });

  it("records the tailnet login that made it", async () => {
    await signUp();
    expect(db.prepare("SELECT created_by_login FROM users").get()).toEqual({ created_by_login: "alex@example.com" });
  });

  it("refuses a bad or taken name before any passkey is made", async () => {
    await expect(startSignUp(db, "a!", rp, T0)).rejects.toThrow(AccountError);
    await signUp("alex");
    await expect(startSignUp(db, "ALEX", rp, T0)).rejects.toThrow("taken");
  });

  it("refuses a name taken while the passkey prompt was open, keeping the first account", async () => {
    const first = await startSignUp(db, "alex", rp, T0);
    const second = await startSignUp(db, "alex", rp, T0);
    await finishSignUp(db, first.challengeId, new SoftAuthenticator().register(first.options, rp), rp, "Mac", null, T0);
    await expect(
      finishSignUp(db, second.challengeId, new SoftAuthenticator().register(second.options, rp), rp, "Mac", null, T0),
    ).rejects.toThrow("taken");
    expect(db.prepare("SELECT COUNT(*) AS n FROM passkeys").get()).toEqual({ n: 1 });
  });

  it("spends the challenge on the first try, and lets it last only five minutes", async () => {
    const device = new SoftAuthenticator();
    const { options, challengeId } = await startSignUp(db, "alex", rp, T0);
    const response = device.register(options, rp);
    await expect(finishSignUp(db, challengeId, response, rp, "Mac", null, T0 + 6 * 60_000)).rejects.toThrow("too long");
    await expect(finishSignUp(db, challengeId, response, rp, "Mac", null, T0)).rejects.toThrow("too long");
  });

  it("won't take a passkey made for another host", async () => {
    const device = new SoftAuthenticator();
    const { options, challengeId } = await startSignUp(db, "alex", rp, T0);
    await expect(finishSignUp(db, challengeId, device.register(options, tailnet), rp, "Mac", null, T0)).rejects.toThrow(
      "couldn't be verified",
    );
    expect(db.prepare("SELECT COUNT(*) AS n FROM users").get()).toEqual({ n: 0 });
  });
});

describe("signing in", () => {
  it("only works at the host the passkey was made on", async () => {
    const { device } = await signUp();
    expect(await signIn(device, tailnet)).toBeNull();
  });

  it("rejects an unknown passkey", async () => {
    await signUp();
    expect(await signIn(new SoftAuthenticator())).toBeNull();
  });

  it("rejects a reused challenge", async () => {
    const { device } = await signUp();
    const { options, challengeId } = await startSignIn(db, rp, T0);
    expect(await finishSignIn(db, challengeId, device.authenticate(options, rp), rp, T0)).not.toBeNull();
    expect(await finishSignIn(db, challengeId, device.authenticate(options, rp), rp, T0)).toBeNull();
  });

  it("won't spend a sign-up challenge on a sign-in", async () => {
    const { device } = await signUp("alex");
    const { options, challengeId } = await startSignUp(db, "blair", rp, T0);
    expect(await finishSignIn(db, challengeId, device.authenticate(options, rp), rp, T0)).toBeNull();
  });

  it("rejects a passkey that names a different account than the one it belongs to", async () => {
    const { device } = await signUp();
    const { options, challengeId } = await startSignIn(db, rp, T0);
    expect(await finishSignIn(db, challengeId, device.authenticate(options, rp, "someone-else"), rp, T0)).toBeNull();
  });
});

describe("passkeys on an account", () => {
  async function sessionFor(userId: number) {
    return findSession(db, createSession(db, userId, null, T0), T0)!;
  }

  it("adds another — for the tailnet address — which then signs in there", async () => {
    const { userId } = await signUp();
    const { session, user } = await sessionFor(userId);
    const phone = new SoftAuthenticator();
    const options = await startAddPasskey(db, session, user, tailnet, T0);
    await finishAddPasskey(db, session, phone.register(options, tailnet), tailnet, "iPhone", T0);
    expect(listPasskeys(db, userId).map((p) => [p.name, p.rpId])).toEqual([
      ["Mac", "localhost"],
      ["iPhone", "outside.example.ts.net"],
    ]);
    expect(await signIn(phone, tailnet)).toBe(userId);
  });

  it("never removes the last one, and only removes the account's own", async () => {
    const { userId } = await signUp("alex");
    const { userId: other } = await signUp("blair");
    const [only] = listPasskeys(db, userId);
    expect(() => removePasskey(db, userId, only.id)).toThrow("only passkey");

    const { session, user } = await sessionFor(userId);
    const options = await startAddPasskey(db, session, user, rp, T0);
    await finishAddPasskey(db, session, new SoftAuthenticator().register(options, rp), rp, "Key", T0);
    removePasskey(db, other, only.id);
    expect(listPasskeys(db, userId)).toHaveLength(2);
    removePasskey(db, userId, only.id);
    expect(listPasskeys(db, userId).map((p) => p.name)).toEqual(["Key"]);
  });

  it("deleting the account takes its passkeys, sessions and preferences with it", async () => {
    const { userId, device } = await signUp();
    createSession(db, userId, null, T0);
    putPrefs(db, userId, { "outside:theme:v1": '"dark"' }, T0);
    deleteUser(db, userId);
    for (const table of ["passkeys", "sessions", "preferences"]) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    }
    expect(await signIn(device)).toBeNull();
  });
});
