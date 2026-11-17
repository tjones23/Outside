import { describe, expect, it } from "vitest";
import { reconcilePrefs } from "./pref-reconcile";
import { SYNCED_PREF_KEYS } from "./synced-prefs";

const THEME = "outside:theme:v1";
const PLACES = "outside:locations:v1";
const NOTIFY = "outside:notify:v1";
const none = new Set<string>();

describe("reconcilePrefs", () => {
  it("first sign-in: this browser's settings move into an empty account", () => {
    const local = { [THEME]: '"light"', [PLACES]: '[{"id":"a"}]' };
    expect(reconcilePrefs({ local, account: {}, pending: none, previousUser: null, user: "alex" })).toEqual({
      apply: {},
      upload: local,
      clearFirst: false,
    });
  });

  it("first sign-in to an account that has settings: the account wins, and fills its gaps from here", () => {
    const plan = reconcilePrefs({
      local: { [THEME]: '"light"', [NOTIFY]: '{"anyWarningAlerts":true}' },
      account: { [THEME]: '"dark"' },
      pending: none,
      previousUser: null,
      user: "alex",
    });
    expect(plan.apply).toEqual({ [THEME]: '"dark"' });
    expect(plan.upload).toEqual({ [NOTIFY]: '{"anyWarningAlerts":true}' });
  });

  it("a later visit: the account's changes from other devices come in", () => {
    const plan = reconcilePrefs({
      local: { [THEME]: '"light"' },
      account: { [THEME]: '"dark"', [PLACES]: "[]" },
      pending: none,
      previousUser: "alex",
      user: "alex",
    });
    expect(plan).toEqual({ apply: { [THEME]: '"dark"', [PLACES]: "[]" }, upload: {}, clearFirst: false });
  });

  it("a change still on its way up isn't overwritten, and is sent again", () => {
    const plan = reconcilePrefs({
      local: { [THEME]: '"light"' },
      account: { [THEME]: '"dark"' },
      pending: new Set([THEME]),
      previousUser: "alex",
      user: "alex",
    });
    expect(plan).toEqual({ apply: {}, upload: { [THEME]: '"light"' }, clearFirst: false });
  });

  it("switching accounts never carries the first one's places into the second", () => {
    const plan = reconcilePrefs({
      local: { [PLACES]: '[{"id":"home"}]' },
      account: { [THEME]: '"dark"' },
      pending: none,
      previousUser: "alex",
      user: "blair",
    });
    expect(plan).toEqual({ apply: { [THEME]: '"dark"' }, upload: {}, clearFirst: true });
  });
});

describe("which preferences an account carries", () => {
  it("has every setting, but not the notifier's per-device record", () => {
    expect(SYNCED_PREF_KEYS).toContain(THEME);
    expect(SYNCED_PREF_KEYS).toContain(PLACES);
    expect(SYNCED_PREF_KEYS.some((k) => k.includes("seen-alerts"))).toBe(false);
    expect(SYNCED_PREF_KEYS.some((k) => k.includes(":account:"))).toBe(false);
  });
});
