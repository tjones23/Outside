/**
 * Hit every upstream once and report pass/fail with timings.
 *
 * The first thing to run when the map looks wrong: it separates "an upstream
 * is down or changed shape" from "the app is broken" in one screen. Uses the
 * same fetchers and parsers as the app, without Next's cache in front.
 *
 *   npm run check:sources
 */
import { gunzipSync } from "node:zlib";
import {
  fetchAlertFeed,
  fetchAlerts,
  fetchForecast,
  fetchGeocode,
  fetchMrmsFile,
  fetchOutlook,
  fetchRadar,
  fetchReportDay,
  fetchTropical,
  fetchWwaOutlines,
  userAgent,
} from "../src/lib/sources/upstream";
import { outlookProduct } from "../src/lib/outlook";
import { convectiveDate } from "../src/lib/reports";
import { RADAR_MAX_NATIVE_ZOOM } from "../src/lib/radar";
import { parseGrib2, recentFrameTimes, type MrmsProduct } from "../src/lib/mrms";

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local is fine — nothing in it is required.
}

let failures = 0;

async function check(name: string, run: () => Promise<string>): Promise<void> {
  const started = performance.now();
  try {
    const detail = await run();
    const ms = Math.round(performance.now() - started);
    console.log(`  \x1b[32m✓\x1b[0m ${name.padEnd(28)} ${String(ms).padStart(5)} ms  ${detail}`);
  } catch (error) {
    failures++;
    const ms = Math.round(performance.now() - started);
    console.log(`  \x1b[31m✗\x1b[0m ${name.padEnd(28)} ${String(ms).padStart(5)} ms  ${(error as Error).message}`);
  }
}

async function tileStatus(url: string, z: number): Promise<number> {
  // A tile over Oklahoma at zoom z.
  const x = Math.floor(((-97.5 + 180) / 360) * 2 ** z);
  const lat = (35.5 * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * 2 ** z);
  const response = await fetch(url.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y)));
  return response.status;
}

async function main(): Promise<void> {
  console.log(`User-Agent: ${userAgent()}\n`);
  const now = new Date();

  await check("NWS active alerts", async () => {
    const { alerts } = await fetchAlertFeed();
    const warnings = alerts.filter((a) => a.isWarning).length;
    return `${alerts.length} active (${warnings} warnings)`;
  });

  await check("NWS alert outlines (map svc)", async () => {
    const outlines = await fetchWwaOutlines();
    return `${Object.keys(outlines).length} zone-based alerts outlined`;
  });

  await check("NWS alerts, joined", async () => {
    const alerts = await fetchAlerts();
    const drawn = alerts.filter((a) => a.polygons.length > 0).length;
    return `${drawn} of ${alerts.length} have an outline`;
  });

  await check("SPC reports (today.csv)", async () => {
    const reports = await fetchReportDay(convectiveDate(now), true);
    return `${reports.length} reports for ${convectiveDate(now)}`;
  });

  await check("SPC reports (yesterday)", async () => {
    const date = convectiveDate(now, 1);
    const reports = await fetchReportDay(date, false);
    return `${reports.length} reports for ${date}`;
  });

  await check("SPC day 1 categorical", async () => {
    const { features } = await fetchOutlook(outlookProduct(1, "categorical"));
    return features.length ? features.map((f) => f.label).join(" ") : "no risk areas";
  });

  await check("SPC day 1 tornado", async () => {
    const { features } = await fetchOutlook(outlookProduct(1, "tornado"));
    const hatched = features.filter((f) => f.isHatched).length;
    return features.length ? `${features.length} areas, ${hatched} hatched` : "no risk areas";
  });

  await check("WPC excessive rainfall d1", async () => {
    const { features } = await fetchOutlook(outlookProduct(1, "rainfall"));
    return features.length ? features.map((f) => f.label).join(" ") : "no risk areas";
  });

  await check("NHC storms + outlook", async () => {
    const { storms, outlook, disturbances } = await fetchTropical();
    const named = storms.map((s) => `${s.name} (${s.forecast.length} pts, ${s.cone.length ? "cone" : "no cone"})`);
    return `${storms.length} storms${named.length ? `: ${named.join(", ")}` : ""}; ${outlook.length} outlook areas, ${disturbances.length} disturbances`;
  });

  await check("HRRR future radar (IEM)", async () => {
    const { frames, runTime } = await fetchForecast("hrrr-refd", Date.now());
    const status = await tileStatus(frames[0].url, 6);
    if (status !== 200) throw new Error(`tile HTTP ${status}`);
    return `${frames.length} frames, run ${new Date((runTime ?? 0) * 1000).toISOString().slice(11, 16)}Z, tile 200`;
  });

  await check("NDFD temperature (WMS)", async () => {
    const { frames } = await fetchForecast("ndfd-temp", Date.now());
    const first = frames[0];
    // Web Mercator only: the service doesn't offer EPSG:4326. This box is Oklahoma.
    const bbox = "-11131949,3503549,-10018754,4163881";
    const tile = `${first.url}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${first.wms!.layers}&STYLES=&SRS=EPSG:3857&BBOX=${bbox}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true&VTIT=${first.wms!.params.vtit}`;
    const response = await fetch(tile);
    if (!response.ok) throw new Error(`GetMap HTTP ${response.status}`);
    return `${frames.length} frames from ${first.wms!.params.vtit}Z, GetMap 200`;
  });

  let latestFrame: string | null = null;
  await check("RainViewer manifest", async () => {
    const manifest = await fetchRadar();
    if (!manifest) throw new Error("no radar section in the manifest");
    latestFrame = manifest.past.at(-1)?.url ?? null;
    return `${manifest.past.length} past, ${manifest.nowcast.length} nowcast frames`;
  });

  if (latestFrame) {
    const frame: string = latestFrame;
    await check(`RainViewer tile z${RADAR_MAX_NATIVE_ZOOM}`, async () => {
      const status = await tileStatus(frame, RADAR_MAX_NATIVE_ZOOM);
      if (status !== 200) throw new Error(`HTTP ${status}`);
      return "HTTP 200";
    });
    await check(`RainViewer tile z${RADAR_MAX_NATIVE_ZOOM + 1}`, async () => {
      // Past zoom 7 the free tier answers 200 with a "Zoom Level Not
      // Supported" placeholder, which is why the map sets maxNativeZoom.
      return `HTTP ${await tileStatus(frame, RADAR_MAX_NATIVE_ZOOM + 1)} (placeholder expected; informational)`;
    });
  }

  for (const product of ["PrecipFlag", "SeamlessHSR"] as MrmsProduct[]) {
    await check(`NOAA MRMS ${product}`, async () => {
      // The newest ten-minute frame NCEP has; the latest is often a minute or two away.
      for (const time of recentFrameTimes(Date.now(), 3)) {
        const file = await fetchMrmsFile(product, time);
        if (!file) continue;
        const { grid } = parseGrib2(gunzipSync(file));
        const age = Math.round((Date.now() / 1000 - time) / 60);
        return `${grid.ni}×${grid.nj} grid, ${age} min old, ${Math.round(file.length / 1024)} KB`;
      }
      throw new Error("none of the last three frames is published");
    });
  }

  await check("Nominatim search", async () => {
    const results = await fetchGeocode("moore, ok");
    if (results.length === 0) throw new Error("no results for 'moore, ok'");
    return `${results[0].name} → ${results[0].lat.toFixed(3)}, ${results[0].lon.toFixed(3)}`;
  });

  console.log(failures ? `\n${failures} failed.` : "\nAll sources reachable.");
}

main().then(
  () => process.exit(failures ? 1 : 0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
