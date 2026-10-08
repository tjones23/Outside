# Outside

Severe weather at a glance: every live NWS warning, watch and advisory (severe
storms, tropical, flood, coastal, heat, winter, wind, fire, marine…), hurricane
and tropical-storm tracks and cones, the last few days of storm reports, SPC
and WPC outlooks, animated radar and forecast animations — HRRR future radar
and the NWS seven-day forecast — on one map, plus your saved places, and a
notification when a new warning covers one of them.

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
| [NWS API](https://www.weather.gov/documentation/services-web-api) | Every active alert — warnings, watches, advisories, statements | every minute |
| [NWS watch/warning map service](https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/MapServer) | Outlines of zone- and county-based alerts, joined to the above by CAP id | 2 min |
| NWS API zones | Outline of any zone the map service lacks (rare) | 7 days |
| [NHC](https://www.nhc.noaa.gov/) `CurrentStorms.json` + [tropical map service](https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer) | Active storms: forecast points, track, cone, coastal watches/warnings, past track; 7-day outlook | 10 min |
| [SPC storm reports](https://www.spc.noaa.gov/climo/reports/) | Preliminary tornado, wind and hail reports, 1–5 days | 5 min (today), 30 min (past days) |
| [SPC outlooks](https://www.spc.noaa.gov/products/outlook/) | Categorical (days 1–3), tornado/wind/hail probabilities (days 1–2) | 15 min |
| [WPC excessive rainfall](https://www.wpc.ncep.noaa.gov/qpf/excessive_rainfall_outlook_ero.php) | Flash-flood risk, days 1–5 | 15 min |
| [NOAA MRMS](https://www.nssl.noaa.gov/projects/mrms/) (`mrms.ncep.noaa.gov`) | Radar, last hour, colored rain or snow; drawn into tiles by this server | 10 min, while radar is on |
| [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu/) | HRRR simulated radar, hourly to 18 h, as tiles | 10 min |
| [NDFD WMS](https://digital.weather.gov/) | NWS 7-day gridded forecast: temperature, feels-like, gusts, rain, rain chance, cloud, snow | 10 min |
| [Esri Dark Gray Canvas](https://www.esri.com/) | Basemap and labels | — |
| [Nominatim](https://nominatim.org/) | Place search when saving a location | on submit only |

## Pages

- **Map** — alerts, hurricanes, reports, shaded damage areas, the selected
  SPC or WPC outlook (with conditional-intensity hatching), and radar or a
  forecast animation. Tap anywhere to list every alert there — zone-based
  alerts stack. A banner tells you when you're inside a warning (or a watch
  or advisory), or near recent reports; storm pills fly to each active storm.
- **Reports** — every report, newest first, or within 50 / 100 / 250 miles of you.
- **Alerts** — every alert, filtered by hazard family (severe, tropical,
  flood, coastal, heat, winter, wind, fire, marine, other) and tier (warning,
  watch, advisory, statement), by recency, severity or distance.
- **Places** — saved places, each with a one-line status; open one for the
  warnings covering it and the reports within 50 miles.
- **Settings** — notifications for new warnings at your places, or anywhere.

## Architecture

```
src/lib/               pure, framework-free, unit-tested
  alerts.ts            NWS GeoJSON → StormAlert; outline joins; sorting
  alert-catalog.ts     every NWS event → hazard family, color, priority
  tropical.ts          NHC storms and outlook → TropicalData
  forecast.ts          HRRR (IEM) and NDFD (WMS) → animation frames
  reports.ts           SPC CSV → StormReport; convective days (12Z–12Z)
  outlook.ts           SPC / WPC outlook GeoJSON → features + hatch lines
  mrms.ts              MRMS GRIB2 (PNG-packed) → rain/snow radar tiles
  precip-type.ts       radar frame URLs, zooms and colors, for the browser
  damage-areas.ts      reports → clustered, buffered "damage" blobs
  filters.ts           per-browser filters and what passes them
  nearby.ts            "near me" and saved-place status
  notifications.ts     which new warnings deserve a notification
  client-store.ts      filters, places, settings — localStorage, per browser
  sources/upstream.ts  every upstream request (uncached, used by scripts too)
  sources/cached.ts    the same behind `use cache` + named cacheLife profiles
src/app/api/*          alerts, reports, outlook, radar, tropical, forecast, geocode — polled by the page
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
./run-prod.command public    # ...and to the internet, via Tailscale Funnel (public off to undo)
./run-prod.command stop      # stop serving and withdraw from both
./run-prod.command setup     # once: let hosting keep a closed-lid Mac awake
```

| | Address |
| --- | --- |
| This Mac | `http://localhost:3001` |
| This network | `http://<lan-ip>:3001` |
| Tailnet | `https://outside.<tailnet>.ts.net` |
| Public | same address as Tailnet, once `public` is on |

**`public` means anyone with the link**, not just your tailnet — Tailscale
Funnel proxies the same address onto the internet. The `*.ts.net` certificate
is visible in public certificate-transparency logs, so the address can be
found without being shared. Place search (`/api/geocode`) is rate-limited per
visitor and site-wide, since it runs under this server's own identity against
an upstream that bans abusive IPs; everything else just serves shared cached
copies of public feeds. `public off` returns to tailnet-only.

**Location and notifications need HTTPS.** Browsers only offer them to a
secure page. They work on `localhost` and the tailnet address; on the plain-HTTP
LAN address the map, lists and place search work, and the app explains why the
other two are missing. On iPhone and iPad, notifications also require adding
Outside to the Home Screen.

Notifications come from the open page checking for new warnings once a minute —
there is no push server. Close every tab and nothing arrives. Outside is not an
official warning source.

**Its own Tailscale node.** On the tailnet, Outside isn't a second port on
this Mac's own Tailscale — it logs in as a separate node (named `outside` by
default; override with `OUTSIDE_TS_HOSTNAME`), via its own userspace
`tailscaled` that only this launcher runs. That's what gives it a clean
address with no port, and it never touches whatever Tailscale this Mac
otherwise uses (WhatsGood's launcher, if it's here too, is left alone). It
needs a one-time login the first time `tailnet` or `public` runs — open the
URL it prints — and, in the Tailscale admin console, "Disable key expiry"
on the `outside` node so it doesn't need another login in ~180 days. State
(including its login keys) lives in `.outside/tailscale/`, gitignored.
Change the port it serves on with `OUTSIDE_TS_PORT` if 443 is ever taken on
that node.

**Running alongside WhatsGood.** Both apps host from the same Mac on
different ports (WhatsGood 3000, Outside 3001) and different Tailscale
nodes, so neither can collide with the other's port or address.
`pmset -a disablesleep` is one switch for the whole machine, so the
closed-lid hold is shared through `scripts/lid-hold.sh` (identical in both
repos): sleep is re-enabled only once neither app is hosting, and either
app's sudoers rule serves both.

Everything else — `next start` rather than `next dev`, sleep held off only
while hosting, a failed rebuild restoring the previous build, servers detached
from the terminal — works exactly as described in WhatsGood's README.

## Known limitations

- **Radar covers the continental US only**, and is drawn by this server:
  tiles through zoom 9 (stretched beyond), the last hour at ten-minute steps.
  MRMS tells rain from snow but has no sleet or freezing-rain class. The first
  view after a quiet spell waits a few seconds while frames are drawn.
- **Zone-based alerts are outlined from a second NWS service.** If that
  service is down they still list, but can't be drawn or checked against your
  places until it's back. Outlines are simplified to about a kilometer.
- **Defaults hide the noisiest families.** Marine alerts (small-craft
  advisories blanket every coast) and statements (Hazardous Weather Outlooks
  and the like) are off until you turn them on in Filters.
- **Forecast animations load frame by frame**, nearest-to-now first, to go easy
  on IEM's and NWS's servers; HRRR steps hourly rather than every 15 minutes
  for the same reason.
- **Reports are preliminary.** SPC's feed is unfiltered first reports and can
  contain duplicates of the same event.
- **Public hosting shares one Mac's bandwidth.** Each open map tab pulls
  about 275 KB a minute of alerts plus map imagery, and Tailscale limits
  Funnel bandwidth — fine for friends and family, not a big audience. The Mac
  has to stay on and hosting for the public link to work.

## Attribution

Alerts and forecast grids: National Weather Service. Tropical: National
Hurricane Center. Reports and convective outlooks: NOAA Storm Prediction
Center. Excessive rainfall: NOAA Weather Prediction Center. Radar: NOAA MRMS.
Future radar: NOAA HRRR via the Iowa Environmental Mesonet. Map tiles: Esri, HERE, Garmin, © OpenStreetMap
contributors. Place search: Nominatim, © OpenStreetMap contributors.
