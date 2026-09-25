# Outside

Severe weather at a glance: live tornado and severe-thunderstorm warnings, the
last few days of storm reports, SPC convective outlooks and animated radar on
one dark map — plus your saved places, and a notification when a new warning
covers one of them.

Everything comes from free, keyless public feeds. There are no accounts; your
places and settings stay in your browser.

Outside is the web app from [DamageTracker](https://github.com/tjones23/DamageTracker)
(an iOS/Android app), rebuilt as a standalone Next.js app in the style of
[WhatsGood](https://github.com/tjones23/WhatsGood) and hosted the same way.

## Setup

```bash
npm install
npm run check:sources   # verify every upstream is reachable
npm run dev             # http://localhost:3001
```

No keys are needed. `.env.example` lists the one optional setting,
`OUTSIDE_CONTACT` — the contact sent in the User-Agent to the National Weather
Service and Nominatim, both of which ask for one. It defaults to this repo.

## Where the data comes from

| Source | What | How often |
| --- | --- | --- |
| [NWS API](https://www.weather.gov/documentation/services-web-api) | Active Tornado / Severe Thunderstorm Warnings and Watches | every minute |
| [SPC storm reports](https://www.spc.noaa.gov/climo/reports/) | Preliminary tornado, wind and hail reports, 1–5 days | 5 min (today), 30 min (past days) |
| [SPC outlooks](https://www.spc.noaa.gov/products/outlook/) | Categorical (days 1–3), tornado/wind/hail probabilities (days 1–2) | 15 min |
| [RainViewer](https://www.rainviewer.com/api.html) | Composite radar, last hour, animated | 2 min |
| [Esri Dark Gray Canvas](https://www.esri.com/) | Basemap and labels | — |
| [Nominatim](https://nominatim.org/) | Place search when saving a location | on submit only |

## Pages

- **Map** — warnings, watches, reports, shaded damage areas, the selected SPC
  outlook (with conditional-intensity hatching) and radar. A banner tells you
  when you're inside a warning or near recent reports.
- **Reports** — every report, newest first, or within 50 / 100 / 250 miles of you.
- **Alerts** — warnings and watches, by recency, severity or distance.
- **Places** — saved places, each with a one-line status; open one for the
  warnings covering it and the reports within 50 miles.
- **Settings** — notifications for new warnings at your places, or anywhere.

## Architecture

```
src/lib/               pure, framework-free, unit-tested
  alerts.ts            NWS GeoJSON → StormAlert; sorting
  reports.ts           SPC CSV → StormReport; convective days (12Z–12Z)
  outlook.ts           SPC outlook GeoJSON → features + hatch lines
  radar.ts             RainViewer manifest → tile templates
  damage-areas.ts      reports → clustered, buffered "damage" blobs
  filters.ts           per-browser filters and what passes them
  nearby.ts            "near me" and saved-place status
  notifications.ts     which new warnings deserve a notification
  client-store.ts      filters, places, settings — localStorage, per browser
  sources/upstream.ts  every upstream request (uncached, used by scripts too)
  sources/cached.ts    the same behind `use cache` + named cacheLife profiles
src/app/api/*          alerts, reports, outlook, radar, geocode — polled by the page
src/components/        UI; the map is hosted in the root layout (see MapHost)
scripts/               launchers' shared shell, lid-hold registry, source check
```

The server returns the same unfiltered data to everyone, so one cache entry
serves every browser; each browser applies its own filters. Upstream failures
are cached for 30 seconds rather than thrown, so an outage costs one upstream
request per feed every half minute, and the page keeps its last good data
while it retries.

The core logic is a TypeScript port of DamageTracker's C# `DamageTracker.Core`,
with two fixes: report ids are stable across refreshes, and report days follow
SPC's 12Z convective day for both file names and labels.

## Commands

```bash
npm run dev            # dev server on :3001
npm run build          # production build
npm test               # unit tests
npm run typecheck
npm run lint
npm run check:sources  # hit every upstream, print pass/fail + timings
```

## Hosting it

Same launchers as WhatsGood. Double-click either in Finder for a menu, or pass
a command:

```bash
./run-dev.command start      # dev server with hot reload
./run-prod.command rebuild   # new production build (restarts it if running)
./run-prod.command start     # serve the last build, to this Mac only
./run-prod.command lan       # ...and to this network, plain HTTP   (lan off to undo)
./run-prod.command tailnet   # ...and to the tailnet, over HTTPS    (tailnet off to undo)
./run-prod.command stop      # stop serving and withdraw from both
./run-prod.command setup     # once: let hosting keep a closed-lid Mac awake
```

| | Address |
| --- | --- |
| This Mac | `http://localhost:3001` |
| This network | `http://<lan-ip>:3001` |
| Tailnet | `https://<machine>.<tailnet>.ts.net:8443` |

**Location and notifications need HTTPS.** Browsers only offer them to a
secure page. They work on `localhost` and the tailnet address; on the plain-HTTP
LAN address the map, lists and place search work, and the app explains why the
other two are missing. On iPhone and iPad, notifications also require adding
Outside to the Home Screen.

Notifications come from the open page checking for new warnings once a minute —
there is no push server. Close every tab and nothing arrives. Outside is not an
official warning source.

**Running alongside WhatsGood.** Both apps host from the same Mac: WhatsGood on
3000 / tailnet 443, Outside on 3001 / tailnet 8443. Each launcher only touches
its own `tailscale serve` port. `pmset -a disablesleep` is one switch for the
whole machine, so the closed-lid hold is shared through `scripts/lid-hold.sh`
(identical in both repos): sleep is re-enabled only once neither app is
hosting, and either app's sudoers rule serves both. Change the ports with
`OUTSIDE_PORT` / `OUTSIDE_TS_PORT` if needed.

Everything else — `next start` rather than `next dev`, sleep held off only
while hosting, a failed rebuild restoring the previous build, servers detached
from the terminal — works exactly as described in WhatsGood's README.

## Known limitations

- **Radar is sharp to zoom 7.** RainViewer's free tier stops there; beyond it
  the zoom-7 tiles are stretched. It also allows 500 tile requests a minute per
  IP, which is why frames load one after another and the loop is the last hour.
- **Many watches have no polygon.** NWS issues them by county, with no geometry,
  so they appear in the Alerts list but not on the map or in saved-place checks.
- **Reports are preliminary.** SPC's feed is unfiltered first reports and can
  contain duplicates of the same event.

## Attribution

Warnings: National Weather Service. Reports and outlooks: NOAA Storm Prediction
Center. Radar: RainViewer. Map tiles: Esri, HERE, Garmin, © OpenStreetMap
contributors. Place search: Nominatim, © OpenStreetMap contributors.
