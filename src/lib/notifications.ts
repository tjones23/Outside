import { alertContains } from "./alerts";
import { passesAlert } from "./filters";
import type { FilterSettings, NotificationSettings, SavedLocation, StormAlert } from "./types";

/**
 * Which new warnings deserve a notification. Ported from
 * `AppState.CheckAlertNotifications`.
 *
 * Pure: given the active alerts and what this browser has already seen, it
 * returns what to show and the next "seen" set. Rules:
 *
 * - Warnings only; watches never notify.
 * - The first run (`seen === null`) only records a baseline. Opening the app
 *   in the middle of an outbreak shouldn't fire twenty notifications at once.
 * - A warning covering a saved location notifies as that location, and only
 *   once — it isn't repeated as a general warning.
 * - "Any warning" respects the category and warning filters.
 * - The seen set becomes exactly the active warnings, so expired ids drop out
 *   and it never grows without bound. It is updated even with notifications
 *   off, so turning them on later doesn't replay old warnings.
 */

export interface PlannedNotification {
  /** Used as the notification tag, so two open tabs collapse to one. */
  id: string;
  title: string;
  body: string;
}

export interface NotificationPlan {
  toShow: PlannedNotification[];
  nextSeen: string[];
}

export function planNotifications(input: {
  alerts: StormAlert[];
  seen: string[] | null;
  settings: NotificationSettings;
  locations: SavedLocation[];
  filters: FilterSettings;
}): NotificationPlan {
  const { alerts, seen, settings, locations, filters } = input;
  const warnings = alerts.filter((a) => a.isWarning);
  const nextSeen = warnings.map((a) => a.id);
  const toShow: PlannedNotification[] = [];

  const enabled = settings.savedLocationAlerts || settings.anyWarningAlerts;
  if (seen === null || !enabled) return { toShow, nextSeen };

  const already = new Set(seen);
  for (const alert of warnings) {
    if (already.has(alert.id)) continue;
    const summary = alert.areaDesc ?? alert.headline ?? "New warning issued.";

    if (settings.savedLocationAlerts) {
      const location = locations.find((loc) => alertContains(alert, [loc.lat, loc.lon]));
      if (location) {
        toShow.push({ id: alert.id, title: alert.event, body: `${location.name}: ${summary}` });
        continue;
      }
    }

    if (settings.anyWarningAlerts && passesAlert(filters, alert)) {
      toShow.push({ id: alert.id, title: alert.event, body: summary });
    }
  }
  return { toShow, nextSeen };
}
