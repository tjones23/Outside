/**
 * Hit every upstream once and report pass/fail with timings.
 *
 * The first thing to run when the map looks wrong: it separates "an upstream
 * is down or changed shape" from "the app is broken" in one screen. Uses the
 * same fetchers and parsers as the app, without Next's cache in front.
 *
 *   npm run check:sources
 */
import { fetchAlerts, fetchGeocode, fetchOutlook, fetchRadar, fetchReportDay, userAgent } from "../src/lib/sources/upstream";
import { outlookProduct } from "../src/lib/outlook";
import { convectiveDate } from "../src/lib/reports";
import { RADAR_MAX_NATIVE_ZOOM } from "../src/lib/radar";

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
    const alerts = await fetchAlerts();
    const warnings = alerts.filter((a) => a.isWarning).length;
    return `${alerts.length} active (${warnings} warnings)`;
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
