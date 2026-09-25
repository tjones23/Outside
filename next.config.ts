import type { NextConfig } from "next";

/**
 * Cache windows for Outside's upstream feeds.
 *
 * Each is a named Next 16 cache profile so `cacheLife("alerts")` reads clearly
 * at the call site in `src/lib/sources/`. `revalidate` is the number that
 * matters: how often a busy server goes back upstream. Every browser polls
 * the API routes on its own timer, and all of them share these entries.
 */
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const nextConfig: NextConfig = {
  cacheComponents: true,

  cacheLife: {
    // Warnings are issued and cancelled minute to minute; NWS itself caches
    // the active-alerts endpoint for about a minute.
    alerts: { stale: 30, revalidate: MINUTE, expire: 3 * MINUTE },
    // Today's SPC reports trickle in all day.
    reportsToday: { stale: MINUTE, revalidate: 5 * MINUTE, expire: 30 * MINUTE },
    // Past days are mostly settled, but SPC does revise them for a while.
    reportsPast: { stale: MINUTE, revalidate: 30 * MINUTE, expire: 6 * HOUR },
    // Outlooks are reissued a handful of times a day.
    outlook: { stale: MINUTE, revalidate: 15 * MINUTE, expire: 2 * HOUR },
    // RainViewer publishes a new frame every ten minutes.
    radar: { stale: 30, revalidate: 2 * MINUTE, expire: 10 * MINUTE },
    // A failed upstream request, remembered briefly so an outage costs one
    // upstream request per feed every half minute, not one per poll.
    failure: { stale: 30, revalidate: 30, expire: MINUTE },
    // Place names don't move. Long caching is also what Nominatim's usage
    // policy asks of every client.
    geocode: { stale: MINUTE, revalidate: 30 * DAY, expire: 90 * DAY },
  },
};

export default nextConfig;
