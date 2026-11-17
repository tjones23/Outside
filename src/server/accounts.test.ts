import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "./db";
import {
  ABSOLUTE_TIMEOUT_MS,
  cookieMaxAgeSeconds,
  countSessions,
  createSession,
  createUser,
  endOtherSessions,
  findSession,
  getPrefs,
  IDLE_TIMEOUT_MS,
  putPrefs,
  TOUCH_INTERVAL_MS,
} from "./accounts";

const T0 = Date.UTC(2026, 10, 17, 18);
const DAY = 86_400_000;
let db: DatabaseSync;
let userId: number;

beforeEach(() => {
  db = openDatabase(":memory:");
  userId = createUser(db, "alex", "handle-1", null, T0);
});

describe("sessions", () => {
  it("finds a session by its cookie, and never stores the cookie itself", () => {
    const token = createSession(db, userId, "Safari", T0);
    expect(findSession(db, token, T0)?.user.username).toBe("alex");
    expect(JSON.stringify(db.prepare("SELECT * FROM sessions").all())).not.toContain(token);
    expect(findSession(db, token + "x", T0)).toBeNull();
  });

  it("slides while in use, then ends after the idle timeout", () => {
    const token = createSession(db, userId, null, T0);
    expect(findSession(db, token, T0 + IDLE_TIMEOUT_MS - DAY)).not.toBeNull();
    // That visit moved last-seen forward, so another idle stretch is fine.
    expect(findSession(db, token, T0 + 2 * IDLE_TIMEOUT_MS - 2 * DAY)).not.toBeNull();
    expect(findSession(db, token, T0 + 3 * IDLE_TIMEOUT_MS)).toBeNull();
    // An expired session is deleted, not just refused.
    expect(countSessions(db, userId)).toBe(0);
  });

  it("only writes last-seen back once in a while", () => {
    const token = createSession(db, userId, null, T0);
    findSession(db, token, T0 + TOUCH_INTERVAL_MS / 2);
    expect(db.prepare("SELECT last_seen_at FROM sessions").get()).toEqual({ last_seen_at: T0 });
    findSession(db, token, T0 + TOUCH_INTERVAL_MS + 1);
    expect(db.prepare("SELECT last_seen_at FROM sessions").get()).toEqual({ last_seen_at: T0 + TOUCH_INTERVAL_MS + 1 });
  });

  it("ends a year after signing in, however active", () => {
    const token = createSession(db, userId, null, T0);
    for (let t = T0; t < T0 + ABSOLUTE_TIMEOUT_MS; t += 30 * DAY) expect(findSession(db, token, t)).not.toBeNull();
    expect(findSession(db, token, T0 + ABSOLUTE_TIMEOUT_MS + 1)).toBeNull();
  });

  it("gives the cookie a lifetime no longer than the session's", () => {
    expect(cookieMaxAgeSeconds({ createdAt: T0, lastSeenAt: T0 }, T0)).toBe(IDLE_TIMEOUT_MS / 1000);
    const late = T0 + ABSOLUTE_TIMEOUT_MS - DAY;
    expect(cookieMaxAgeSeconds({ createdAt: T0, lastSeenAt: late }, late)).toBe(DAY / 1000);
  });

  it("signs out every other browser, keeping this one", () => {
    const here = createSession(db, userId, null, T0);
    createSession(db, userId, null, T0);
    createSession(db, userId, null, T0);
    expect(endOtherSessions(db, userId, findSession(db, here, T0)!.session.idHash)).toBe(2);
    expect(findSession(db, here, T0)).not.toBeNull();
  });
});

describe("preferences", () => {
  it("stores and returns them, last write winning per key", () => {
    putPrefs(db, userId, { "outside:theme:v1": '"dark"', "outside:locations:v1": "[]" }, T0);
    putPrefs(db, userId, { "outside:theme:v1": '"light"' }, T0 + 1);
    expect(getPrefs(db, userId)).toEqual({ "outside:theme:v1": '"light"', "outside:locations:v1": "[]" });
  });

  it("keeps each account's apart", () => {
    const other = createUser(db, "blair", "handle-2", null, T0);
    putPrefs(db, userId, { "outside:theme:v1": '"dark"' }, T0);
    expect(getPrefs(db, other)).toEqual({});
  });

  it("drops unknown keys, non-JSON and oversized values, storing the rest", () => {
    const stored = putPrefs(
      db,
      userId,
      {
        "outside:theme:v1": '"dark"',
        "outside:seen-alerts:v2": "[]",
        "something-else": "1",
        "outside:notify:v1": "{not json",
        "outside:locations:v1": JSON.stringify("x".repeat(70_000)),
      },
      T0,
    );
    expect(stored).toEqual({ "outside:theme:v1": '"dark"' });
    expect(getPrefs(db, userId)).toEqual({ "outside:theme:v1": '"dark"' });
  });

  it("ignores anything that isn't an object of strings", () => {
    expect(putPrefs(db, userId, null, T0)).toEqual({});
    expect(putPrefs(db, userId, ["outside:theme:v1"], T0)).toEqual({});
    expect(putPrefs(db, userId, { "outside:theme:v1": 5 }, T0)).toEqual({});
  });
});
