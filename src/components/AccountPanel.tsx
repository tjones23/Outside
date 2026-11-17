"use client";

import { useState, useSyncExternalStore, useTransition, type FormEvent } from "react";
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import {
  addPasskeyAction,
  addPasskeyOptionsAction,
  deleteAccountAction,
  removePasskeyAction,
  signInAction,
  signInOptionsAction,
  signOutAction,
  signOutOthersAction,
  signUpAction,
  signUpOptionsAction,
  type AccountState,
} from "@/app/actions/account";
import { releaseAccount } from "@/lib/account-sync";
import { useAccount } from "./providers/AccountProvider";
import { Button, ErrorNote } from "./ui/controls";

/**
 * Settings' account section: sign in with a passkey, make an account, and
 * once signed in, its passkeys. The browser half of server/passkeys.ts — the
 * OS's own passkey prompt, then the server checks what it returns.
 */

const noop = () => () => {};

function cancelled(error: unknown) {
  return error instanceof Error && (error.name === "NotAllowedError" || error.name === "AbortError");
}

/** A first guess at what to call a new passkey, so the list says where each one lives. */
function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "iPad";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows";
  return "Passkey";
}

const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

const inputClass =
  "w-full min-w-0 rounded-xl border border-line bg-surface-2 px-3 py-2 text-text focus:border-accent/60 focus:outline-none";

/** Runs one passkey step, turning the browser's errors into something to show. */
function usePasskeyStep() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function run(step: () => Promise<string | null>, failed: string) {
    setError(null);
    startTransition(async () => {
      try {
        setError(await step());
      } catch (e) {
        setError(cancelled(e) ? null : failed);
      }
    });
  }
  return { pending, error, setError, run };
}

export function AccountPanel() {
  const { state } = useAccount();
  const supported = useSyncExternalStore(noop, browserSupportsWebAuthn, () => true);

  if (!state) {
    return <div className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-muted-dim">Checking…</div>;
  }
  if (state.signedIn) return <SignedIn state={state} />;
  if (!state.secure || !supported) {
    return (
      <p className="rounded-xl border border-watch/30 bg-watch/10 px-4 py-3 text-sm text-text">
        {state.secure
          ? "This browser doesn't support passkeys, which Outside accounts sign in with."
          : "Accounts sign in with passkeys, and browsers only allow passkeys over HTTPS. Open Outside at its tailnet address (https://…ts.net) to sign in."}
      </p>
    );
  }
  return <SignedOut canSignUp={state.canSignUp} />;
}

function SignedOut({ canSignUp }: { canSignUp: boolean }) {
  const { refresh } = useAccount();
  const signIn = usePasskeyStep();
  const signUp = usePasskeyStep();
  const [username, setUsername] = useState("");

  function onSignIn() {
    signIn.run(async () => {
      const start = await signInOptionsAction();
      if (!start.ok) return start.error;
      const response = await startAuthentication({ optionsJSON: start.options });
      await releaseAccount();
      const result = await signInAction(start.challengeId, response);
      if (!result.ok) return result.error;
      await refresh();
      return null;
    }, "That passkey didn't work. Try again.");
  }

  function onSignUp(event: FormEvent) {
    event.preventDefault();
    signUp.run(async () => {
      const start = await signUpOptionsAction(username);
      if (!start.ok) return start.error;
      const response = await startRegistration({ optionsJSON: start.options });
      await releaseAccount();
      const result = await signUpAction(start.challengeId, response, deviceName());
      if (!result.ok) return result.error;
      await refresh();
      return null;
    }, "This browser couldn't make a passkey.");
  }

  return (
    <div className="space-y-3">
      <div className="space-y-3 rounded-2xl border border-line bg-surface px-4 py-3">
        <p className="text-sm text-muted">
          Sign in to keep your places, filters and settings in an account instead of this browser — the same on every
          device you sign in on.
        </p>
        <Button variant="primary" onClick={onSignIn} disabled={signIn.pending} className="w-full">
          {signIn.pending ? "Waiting for your passkey…" : "Sign in with a passkey"}
        </Button>
        {signIn.error && <ErrorNote>{signIn.error}</ErrorNote>}
      </div>

      {canSignUp ? (
        <form onSubmit={onSignUp} className="space-y-2 rounded-2xl border border-line bg-surface px-4 py-3">
          <label className="block text-sm">
            <span className="mb-1 block text-muted">New here? Pick a name for your account</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={32}
              placeholder="e.g. alex"
              className={inputClass}
            />
          </label>
          <Button type="submit" disabled={signUp.pending || username.trim().length < 3}>
            {signUp.pending ? "Waiting for your passkey…" : "Create account with a passkey"}
          </Button>
          {signUp.error && <ErrorNote>{signUp.error}</ErrorNote>}
          <p className="text-xs text-muted-dim">
            No password: your device makes a passkey, unlocked with Face ID, Touch ID or its passcode. What this browser
            has saved now becomes the account&apos;s.
          </p>
        </form>
      ) : (
        <p className="text-xs text-muted-dim">New accounts can be made from the tailnet address.</p>
      )}
    </div>
  );
}

function SignedIn({ state }: { state: Extract<AccountState, { signedIn: true }> }) {
  const { refresh } = useAccount();
  const add = usePasskeyStep();
  const action = usePasskeyStep();
  const [confirming, setConfirming] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const hereCount = state.passkeys.filter((p) => p.rpId === state.host).length;

  function onAdd() {
    add.run(async () => {
      const start = await addPasskeyOptionsAction();
      if (!start.ok) return start.error;
      const result = await addPasskeyAction(await startRegistration({ optionsJSON: start.options }), deviceName());
      if (!result.ok) return result.error;
      await refresh();
      return null;
    }, "This browser couldn't make a passkey.");
  }

  function run(step: () => Promise<{ ok: true } | { ok: false; error: string }>, before?: () => Promise<void>) {
    action.run(async () => {
      await before?.();
      const result = await step();
      if (!result.ok) return result.error;
      await refresh();
      return null;
    }, "Something went wrong. Try again.");
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-line bg-surface px-4 py-3">
        <p className="text-sm">
          Signed in as <span className="font-semibold">{state.username}</span>
        </p>
        <p className="mt-1 text-xs text-muted-dim">
          Your places, filters and settings are saved to this account, and follow you to every device you sign in on.
          Signing out leaves this browser with the defaults.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => run(() => signOutAction(), releaseAccount)} disabled={action.pending}>
            Sign out
          </Button>
          {state.otherSessions > 0 && (
            <Button variant="ghost" onClick={() => run(signOutOthersAction)} disabled={action.pending}>
              Sign out {state.otherSessions} other {state.otherSessions === 1 ? "browser" : "browsers"}
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-surface px-4 py-2">
        <ul className="divide-y divide-line-soft">
          {state.passkeys.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{p.name}</p>
                <p className="text-xs text-muted-dim">
                  {p.rpId === state.host ? "Works here" : `For ${p.rpId}`} · added {dateFormat.format(p.createdAt)}
                  {p.lastUsedAt ? ` · last used ${dateFormat.format(p.lastUsedAt)}` : ""}
                </p>
              </div>
              {state.passkeys.length > 1 && (
                <Button variant="ghost" onClick={() => run(() => removePasskeyAction(p.id))} disabled={action.pending}>
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
        <div className="py-2.5">
          <Button onClick={onAdd} disabled={add.pending}>
            {add.pending ? "Waiting…" : "Add a passkey"}
          </Button>
          <p className="mt-2 text-xs text-muted-dim">
            {hereCount === 0
              ? "None of these passkeys is for this address — add one to sign in here next time."
              : "Passkeys in iCloud Keychain or Google Password Manager reach your other devices on their own. Add one here for a device that doesn't share them, or a security key."}
          </p>
        </div>
        {add.error && <ErrorNote>{add.error}</ErrorNote>}
      </div>

      {action.error && <ErrorNote>{action.error}</ErrorNote>}

      <div className="rounded-2xl border border-line bg-surface px-4 py-3">
        {confirming ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => deleteAccountAction(confirmName), releaseAccount);
            }}
          >
            <label className="block text-sm">
              <span className="mb-1 block text-muted">
                This deletes the account, its passkeys and everything saved to it. Type{" "}
                <span className="font-semibold text-text">{state.username}</span> to confirm.
              </span>
              <input
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                autoCapitalize="none"
                spellCheck={false}
                className={inputClass}
              />
            </label>
            <div className="flex gap-2">
              <Button type="submit" variant="danger" disabled={action.pending || confirmName.trim().toLowerCase() !== state.username}>
                Delete account
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="ghost" onClick={() => setConfirming(true)}>
            Delete account…
          </Button>
        )}
      </div>
    </div>
  );
}
