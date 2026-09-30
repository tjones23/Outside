"use client";

import { useState, useSyncExternalStore } from "react";
import { useNotificationSettings, useThemePreference } from "@/lib/client-store";
import type { ThemePreference } from "@/lib/theme";
import type { NotificationSettings } from "@/lib/types";
import { registerServiceWorker } from "./AlertNotifier";
import { PageHeader } from "./PageHeader";
import { SecureContextNote } from "./SecureContextNote";
import { useSecureContext } from "./providers/useSecureContext";
import { Button, SectionTitle, Segmented, Switch } from "./ui/controls";

type Permission = NotificationPermission | "unsupported";

function readPermission(): Permission {
  return "Notification" in window ? Notification.permission : "unsupported";
}

const PERMISSION_EVENT = "outside:notification-permission";

/** Notification permission, re-read on focus and after we ask for it. */
function usePermission(): Permission {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("focus", onChange);
      window.addEventListener(PERMISSION_EVENT, onChange);
      return () => {
        window.removeEventListener("focus", onChange);
        window.removeEventListener(PERMISSION_EVENT, onChange);
      };
    },
    readPermission,
    () => "default" as Permission,
  );
}

/** iOS only lets a web app notify once it's been added to the Home Screen. */
function useNeedsHomeScreen(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () =>
      /iPhone|iPad|iPod/.test(navigator.userAgent) &&
      !window.matchMedia("(display-mode: standalone)").matches &&
      !("Notification" in window),
    () => false,
  );
}

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function SettingsPanel() {
  const { preference, setPreference } = useThemePreference();
  const { settings, update } = useNotificationSettings();
  const secure = useSecureContext();
  const permission = usePermission();
  const needsHomeScreen = useNeedsHomeScreen();
  const [testSent, setTestSent] = useState(false);

  const canNotify = secure && permission !== "unsupported";

  async function toggle(patch: Partial<NotificationSettings>) {
    const turningOn = Object.values(patch).some(Boolean);
    if (turningOn && permission === "default") {
      await Notification.requestPermission();
      await registerServiceWorker();
      window.dispatchEvent(new Event(PERMISSION_EVENT));
    }
    update(patch);
  }

  async function sendTest() {
    const registration = await registerServiceWorker();
    const options = { body: "Notifications from Outside are working.", tag: "outside-test", icon: "/icon/large" };
    if (registration) await registration.showNotification("Outside", options);
    else new Notification("Outside", options);
    setTestSent(true);
  }

  return (
    <>
      <PageHeader title="Settings" />

      <SectionTitle>Appearance</SectionTitle>
      <div className="rounded-2xl border border-line bg-surface px-4 py-3">
        <Segmented label="Theme" value={preference} options={THEME_OPTIONS} onChange={setPreference} />
        <p className="mt-2 text-xs text-muted-dim">
          System matches your device, and switches along with it between light and dark.
        </p>
      </div>

      <SectionTitle>Notifications</SectionTitle>
      <div className="rounded-2xl border border-line bg-surface px-4 py-2">
        <Switch
          label="Warnings at my saved places"
          description="When a new tornado or severe thunderstorm warning covers one of your places."
          checked={settings.savedLocationAlerts}
          disabled={!canNotify || permission === "denied"}
          onChange={(v) => void toggle({ savedLocationAlerts: v })}
        />
        <div className="h-px bg-line-soft" />
        <Switch
          label="Every new warning"
          description="Any new warning that passes your filters, anywhere in the US."
          checked={settings.anyWarningAlerts}
          disabled={!canNotify || permission === "denied"}
          onChange={(v) => void toggle({ anyWarningAlerts: v })}
        />
      </div>

      <div className="mt-3 space-y-3 text-sm text-muted">
        <SecureContextNote feature="Notifications" />
        {secure && needsHomeScreen && (
          <p className="rounded-xl border border-line bg-surface px-4 py-3">
            On iPhone and iPad, notifications work once Outside is on your Home Screen: tap Share, then “Add to
            Home Screen”, and open it from there.
          </p>
        )}
        {secure && permission === "denied" && (
          <p className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-text">
            This browser has blocked notifications for Outside. Allow them in the site settings, then come back.
          </p>
        )}
        <p className="text-xs text-muted-dim">
          Outside checks for new warnings once a minute while it&apos;s open in a tab or on your Home Screen. It
          has no push server, so with every tab closed nothing arrives — it doesn&apos;t replace Wireless
          Emergency Alerts or a weather radio.
        </p>
        {permission === "granted" && (
          <Button onClick={() => void sendTest()}>{testSent ? "Sent — check your notifications" : "Send a test notification"}</Button>
        )}
      </div>
    </>
  );
}
