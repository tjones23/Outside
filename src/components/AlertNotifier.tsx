"use client";

import { useEffect } from "react";
import { readSeenAlerts, useFilters, useNotificationSettings, useSavedLocations, writeSeenAlerts } from "@/lib/client-store";
import { planNotifications } from "@/lib/notifications";
import { useStormData } from "./providers/StormDataProvider";

/**
 * Turns each new alerts poll into notifications, while any tab is open.
 *
 * There is no push server: notifications come from this page noticing a new
 * warning on its once-a-minute poll. Closing every tab stops them — the same
 * as the mobile app, which only checked on refresh.
 */

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!window.isSecureContext || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    return null;
  }
}

async function show(id: string, title: string, body: string): Promise<void> {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const options: NotificationOptions = {
    body,
    // One notification per warning, even when two tabs both decide to show it.
    tag: id,
    icon: "/icon/large",
    data: { url: "/alerts" },
  };
  const registration = await registerServiceWorker();
  if (registration) {
    await registration.showNotification(title, options);
    return;
  }
  try {
    new Notification(title, options);
  } catch {
    // Some browsers only allow worker-shown notifications.
  }
}

export function AlertNotifier() {
  const { alerts } = useStormData();
  const { settings } = useNotificationSettings();
  const { locations } = useSavedLocations();
  const { filters } = useFilters();

  const data = alerts.data?.alerts;
  const updatedAt = alerts.updatedAt;

  useEffect(() => {
    void registerServiceWorker();
  }, []);

  // Once per successful poll. Settings changes on their own don't re-run the
  // plan, so toggling a switch can't replay warnings already on the map.
  useEffect(() => {
    if (!data || updatedAt === null) return;
    const plan = planNotifications({ alerts: data, seen: readSeenAlerts(), settings, locations, filters });
    writeSeenAlerts(plan.nextSeen);
    for (const n of plan.toShow) void show(n.id, n.title, n.body);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [updatedAt]);

  return null;
}
