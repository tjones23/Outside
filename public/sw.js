/*
 * Outside's service worker. It exists for notifications only.
 *
 * Android Chrome won't show a page-created `new Notification()` at all, and
 * an iOS Home Screen app can only notify through a service worker — so
 * warnings are shown through `registration.showNotification`, and this
 * worker's one job is to bring the app forward when one is tapped.
 *
 * It deliberately has no fetch handler and caches nothing: storm data that
 * could be served stale from a cache is worse than no data.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/alerts", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
