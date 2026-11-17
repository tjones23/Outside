"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { accountStateAction, type AccountState } from "@/app/actions/account";
import { flushPrefs, pendingKeys, queueUpload, readOwner, startSyncing, stopSyncing, writeOwner } from "@/lib/account-sync";
import { applyAccountPrefs, clearLocalPrefs, readLocalPrefs } from "@/lib/client-store";
import { reconcilePrefs } from "@/lib/pref-reconcile";

/**
 * The signed-in account, if any, fetched once the page is up and again on
 * coming back to the tab (at most every 30 seconds) — so places saved on the
 * phone appear on the laptop without a reload. Each fetch reconciles this
 * browser's preferences with the account's (lib/pref-reconcile.ts).
 *
 * `state` is null until the first answer. Nothing waits on it: every page
 * reads preferences from localStorage, which already holds the account's
 * last-known copy.
 */

interface AccountContextValue {
  state: AccountState | null;
  /** Fetch the account again — after signing in or out, or changing passkeys. */
  refresh: () => Promise<void>;
}

const AccountContext = createContext<AccountContextValue>({ state: null, refresh: async () => {} });

export function useAccount(): AccountContextValue {
  return useContext(AccountContext);
}

const REFETCH_MS = 30_000;

export function AccountProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AccountState | null>(null);
  const lastFetch = useRef(0);
  const refreshRef = useRef<() => Promise<void>>(async () => {});

  const refresh = useCallback(async () => {
    lastFetch.current = Date.now();
    let next: AccountState;
    try {
      await flushPrefs();
      next = await accountStateAction();
    } catch {
      // Server unreachable: keep what we have. Not a sign-out.
      return;
    }
    if (next.signedIn) {
      const plan = reconcilePrefs({
        local: readLocalPrefs(),
        account: next.prefs,
        pending: pendingKeys(),
        previousUser: readOwner(),
        user: next.username,
      });
      if (plan.clearFirst) {
        stopSyncing();
        clearLocalPrefs();
      }
      applyAccountPrefs(plan.apply);
      writeOwner(next.username);
      startSyncing(() => void refreshRef.current());
      queueUpload(plan.upload);
    } else {
      stopSyncing();
      // This browser held an account's copy and the session has ended — signed
      // out here, elsewhere, or expired. Back to the defaults.
      if (readOwner() !== null) {
        clearLocalPrefs();
        writeOwner(null);
      }
    }
    setState(next);
  }, []);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    // Deferred a tick so the first fetch is not a synchronous effect update.
    const first = setTimeout(() => void refresh(), 0);
    const onVisible = () => {
      if (document.visibilityState === "hidden") void flushPrefs();
      else if (Date.now() - lastFetch.current > REFETCH_MS) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearTimeout(first);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refresh]);

  const value = useMemo(() => ({ state, refresh }), [state, refresh]);
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}
