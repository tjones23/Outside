# Outside

Severe weather at a glance: every live NWS warning, watch and advisory (severe
storms, tropical, flood, coastal, heat, winter, wind, fire, marine…), hurricane
and tropical-storm tracks and cones, the last few days of storm reports, SPC
and WPC outlooks, animated radar and forecast animations — HRRR future radar
and the NWS seven-day forecast — wildfires with their perimeters, satellite
hotspots, smoke and air quality, on one map, plus your saved places, and a
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
| [NDFD WMS](https://digital.weather.gov/) | NWS 7-day gridded forecast: temperature, feels-like, gusts, rain, rain chance, cloud, snow; tiles come through this server (`/api/ndfd`), since the WMS sends no CORS headers | 10 min |
| [NWS API](https://www.weather.gov/documentation/services-web-api) `points` + `gridpoints` | A saved place's 7-day forecast: day/night periods, new snow and precipitation per day | 15 min (grid cell lookup: 7 days), on opening a place |
| [Open-Meteo](https://open-meteo.com/) forecast + ensemble APIs | A saved place's 15-day snow blend: HRRR, HRDPS, NBM, ECMWF IFS, GFS, ICON, GDPS, ECMWF AIFS, AIGFS; GEFS and AIFS ensembles. Free for non-commercial use, CC BY 4.0 | 1 h (HRRR, HRDPS, NBM), 3 h (global), 6 h (ensembles), on opening a place |
| [NIFC WFIGS](https://data-nifc.opendata.arcgis.com/) | Wildfires not yet out (size, containment, cause) and their mapped perimeters | 5 min (fires), 15 min (perimeters) |
| [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/) VIIRS via [Esri Living Atlas](https://livingatlas.arcgis.com/) | Satellite fire hotspots, last 24 h, US and Canada | 15 min, while on |
| [NOAA HMS](https://www.ospo.noaa.gov/products/land/hms.html) | Smoke plumes by density, today's (UTC) analysis or yesterday's until today's is drawn | 30 min, while on |
| [EPA AirNow](https://www.airnow.gov/) hourly files (`files.airnowtech.org`) | Each monitor's AQI (worst of PM2.5, ozone, PM10, NO₂), newest published hour, US and Canada | 15 min, while on |
| [Esri Dark Gray Canvas](https://www.esri.com/) | The gray basemap and its labels | — |
| [OpenFreeMap](https://openfreemap.org/) (OpenStreetMap, OpenMapTiles schema) | The Explore basemap's streets, land cover and labels, as vector tiles drawn by MapLibre GL | — |
| [Terrain Tiles on AWS](https://registry.opendata.aws/terrain-tiles/) (Mapzen terrarium) | The Explore basemap's terrain shading, and its 3D terrain when tilted | — |
| [Open-Meteo](https://open-meteo.com/) forecast API, `past_days` | A place's last 15 days of snow: HRRR, NBM, ECMWF IFS, GFS, through the blend's snow ratio | 1 h, on opening a place |
| [USDA NRCS AWDB](https://wcc.sc.egov.usda.gov/awdbRestApi/swagger-ui/index.html) (SNOTEL) | Measured snow depth and water: every station's latest depth for the lists, and the nearest station's last 15 days for a place | 30 min (station list: 1 day) |
| [Nominatim](https://nominatim.org/) | Place search when saving a location | on submit only |

## Pages

- **Map** — alerts, hurricanes, reports, shaded damage areas, the selected
  SPC or WPC outlook (with conditional-intensity hatching), radar or a
  forecast animation, and wildfires: each fire sized by acres and colored by
  containment, its perimeter, and — when switched on — satellite hotspots,
  smoke and air-quality monitors. Tap anywhere to list every alert there — zone-based
  alerts stack. A banner tells you when you're inside a warning (or a watch
  or advisory), or near recent reports; storm pills fly to each active storm.
  Two basemaps, under Filters → Map: Esri's gray canvas, or Explore, a
  terrain-shaded street map. The map is MapLibre GL: drag with two fingers
  (or right-drag) to rotate and tilt; tilted, the Explore map rises in 3D.
- **Reports** — every report, newest first, or within 50 / 100 / 250 miles of you.
- **Alerts** — every alert, filtered by hazard family (severe, tropical,
  flood, coastal, heat, winter, wind, fire, marine, other) and tier (warning,
  watch, advisory, statement), by recency, severity or distance.
- **Places** — two tabs. *Favorites*: where you are, pinned on top, then
  saved places in your own order, each with a one-line status and the
  nearest SNOTEL snow depth. *Ski resorts*: every lift-served ski area in the
  state you're in (or one you pick), nearest first or in your own order,
  filtered by name and by Epic / Ikon / independent; star one to add it to
  favorites. A resort links to its website and, for Epic and Ikon resorts
  so far, its webcam page. Open any place for the warnings covering it, then tabs for its
  7-day NWS forecast (snow and precipitation amounts per day), snow (depth
  on the ground from the nearest SNOTEL, the last 15 days modeled and
  measured, and a 15-day blend across eleven weather models with each day's
  range), and the reports within 50 miles. The last tab used is remembered
  in the browser.
- **Settings** — notifications for new warnings at your places, or anywhere.

## Architecture

```
src/lib/               pure, framework-free, unit-tested
  alerts.ts            NWS GeoJSON → StormAlert; outline joins; sorting
  alert-catalog.ts     every NWS event → hazard family, color, priority
  tropical.ts          NHC storms and outlook → TropicalData
  forecast.ts          HRRR (IEM) and NDFD (WMS) → animation frames
  point-forecast.ts    NWS points/forecast/grid → a place's 7 days with snow and precip
  openmeteo.ts         the blend's models, their weights by lead time, Open-Meteo parsing
  snow-ratio.ts        rain/snow split (wet-bulb, warm layer) and Kuchera snow ratio
  snow-blend.ts        per-model snow → half-day totals → weighted blend and ranges
  snow-past.ts         the models' last 15 days through the same snow ratio
  snotel.ts            SNOTEL stations, depths, nearest station, measured new snow
  resorts.ts           ski resorts: which state you're in, filter, sort, custom order
  reports.ts           SPC CSV → StormReport; convective days (12Z–12Z)
  outlook.ts           SPC / WPC outlook GeoJSON → features + hatch lines
  mrms.ts              MRMS GRIB2 (PNG-packed) → rain/snow radar tiles
  precip-type.ts       radar frame URLs, zooms and colors, for the browser
  damage-areas.ts      reports → clustered, buffered "damage" blobs
  wildfire.ts          WFIGS fires and perimeters, VIIRS hotspots (ArcGIS GeoJSON)
  smoke.ts             HMS smoke KML → plumes
  air-quality.ts       AirNow hourly CSV → monitors with AQI
  filters.ts           per-browser filters and what passes them
  nearby.ts            "near me" and saved-place status
  notifications.ts     which new warnings deserve a notification
  client-store.ts      filters, places, settings — localStorage, per browser
  sources/upstream.ts  every upstream request (uncached, used by scripts too)
  sources/cached.ts    the same behind `use cache` + named cacheLife profiles
src/app/api/*          alerts, reports, outlook, radar, tropical, forecast, point-forecast, snow-blend, snow-past, snow-depth, fires, hotspots, smoke, air, geocode — polled by the page
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
npm run check:webcams  # find resort webcam links that have gone 404
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
- **Wildfire data trails the fire line.** A new fire reaches WFIGS only once
  dispatch enters it, and most perimeters are remapped once a day after night
  infrared flights. Containment is unreported for many new starts, which are
  drawn with the active fires. There are no evacuation zones: no national
  public feed of them exists.
- **Hotspots come from polar-orbiting satellites** that pass a few times a
  day, so a fire can burn for hours before its first one appears; a hotspot is
  any hot 375 m pixel — industrial flares and farm burns included.
- **Smoke is the whole air column**, as seen from above — not a measure of
  air quality at the ground. The AirNow monitors are that measure, but only
  where there's a monitor, and an hour or two behind.
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
Future radar: NOAA HRRR via the Iowa Environmental Mesonet. Wildfires and
perimeters: NIFC WFIGS. Hotspots: NASA FIRMS (VIIRS) via Esri Living Atlas.
Smoke: NOAA NESDIS Hazard Mapping System. Air quality: EPA AirNow. Map tiles: Esri, HERE, Garmin, © OpenStreetMap
contributors. Place search: Nominatim, © OpenStreetMap contributors. Snow depth:
USDA NRCS SNOTEL. Ski resorts: OpenSkiMap, © OpenStreetMap contributors (ODbL).
