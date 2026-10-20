/**
 * Open every resort's webcam link in `public/resorts.json` and report the
 * ones that are gone.
 *
 * Resorts move their cam pages between seasons, and the links are kept by
 * hand in `scripts/build-resorts.ts`. A 404, a 410 or a site that doesn't
 * answer fails; anything else passes. Several resorts (Vail Resorts and some
 * Alterra mountains) answer scripts with a bot check rather than the page, and
 * those still pass: the check can't see past them.
 *
 *   npm run check:webcams
 */
import { readFileSync } from "node:fs";
import type { Resort } from "../src/lib/resorts";

const CONCURRENCY = 8;
const GONE = new Set([404, 410]);

async function status(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
      headers: { "User-Agent": "Mozilla/5.0 (Outside check-webcams; https://github.com/tjones23/Outside)" },
    });
    await response.body?.cancel();
    return GONE.has(response.status) ? `HTTP ${response.status}` : "";
  } catch (error) {
    return (error as Error).message;
  }
}

async function main(): Promise<void> {
  const { resorts } = JSON.parse(readFileSync("public/resorts.json", "utf8")) as { resorts: Resort[] };
  const links = [...new Set(resorts.flatMap((r) => (r.webcams ? [r.webcams] : [])))];
  const failed: [string, string][] = [];
  const queue = [...links];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let url = queue.shift(); url; url = queue.shift()) {
        const problem = await status(url);
        if (problem) failed.push([url, problem]);
      }
    }),
  );
  for (const [url, problem] of failed) console.log(`  \x1b[31m✗\x1b[0m ${url}  ${problem}`);
  console.log(`\n${links.length - failed.length} of ${links.length} webcam links answer.`);
  process.exit(failed.length ? 1 : 0);
}

main();
