import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { promisify } from "node:util";
import { deflate, deflateSync, gunzip, inflate } from "node:zlib";
import {
  dbzTable,
  emptyCellGrid,
  indexedPng,
  kindTable,
  packRows,
  parseGrib2,
  readPng,
  recentFrameTimes,
  renderTile,
  samplesOf,
  scanlines,
  TILE_SIZE,
  tileRange,
  unfilterRows,
  type CellGrid,
  type GribField,
  type LatLonGrid,
  type Samples,
} from "../mrms";
import {
  PRECIP_TYPE_FRAMES,
  PRECIP_TYPE_MAX_NATIVE_ZOOM,
  PRECIP_TYPE_MIN_ZOOM,
  PRECIP_TYPE_STEP_SECONDS,
} from "../precip-type";
import { fetchMrmsFile } from "./upstream";

/**
 * Rain-and-snow radar frames, drawn on this server and kept on disk.
 *
 * Nothing runs on a timer. Each poll of `/api/mrms` calls `refreshIfDue`,
 * which at most once a minute brings `.outside/mrms/` up to date: any of the
 * last hour's frames not yet drawn are fetched from NCEP and drawn, newest
 * first, and older ones deleted. So the work happens only while someone has
 * the rain/snow radar open, and a frame is drawn once however many are
 * watching.
 *
 * A frame is about 1.2 MB of downloads and a few seconds of CPU on an
 * older Mac. The drawing yields to the event loop between bands of rows and
 * batches of tiles, and inflate/deflate run on libuv's thread pool, so pages
 * and API calls keep being answered while it works.
 */

const DATA_DIR = join(process.cwd(), ".outside", "mrms");
/** How often a refresh may go back to NCEP; polls in between just read the disk. */
const REFRESH_MS = 60_000;
/** Times checked per refresh: the loop, plus slack for the newest not being published yet. */
const CANDIDATES = PRECIP_TYPE_FRAMES + 2;
/** Older frames than this are never shown — after a quiet night, they're history. */
const MAX_AGE_SECONDS = CANDIDATES * PRECIP_TYPE_STEP_SECONDS;
const ROWS_PER_TURN = 250;
const TILES_PER_TURN = 16;

const gunzipAsync = promisify(gunzip);
const inflateAsync = promisify(inflate);
const deflateAsync = promisify(deflate);

interface State {
  running: Promise<void> | null;
  lastStart: number;
  lastError: string | null;
  /** Called whenever a frame is finished. */
  listeners: Set<() => void>;
}

// One per process, kept on globalThis so a dev-server reload of this module
// doesn't start a second refresh beside the first.
const g = globalThis as { __outsideMrms?: State };
const state: State = (g.__outsideMrms ??= { running: null, lastStart: 0, lastError: null, listeners: new Set() });

function isFrameName(name: string): boolean {
  return /^\d{10}$/.test(name);
}

async function framesOnDisk(): Promise<number[]> {
  try {
    return (await readdir(DATA_DIR)).filter(isFrameName).map(Number);
  } catch {
    return [];
  }
}

/** The finished frames worth showing at `nowMs`, oldest first. */
export async function availableFrames(nowMs: number): Promise<number[]> {
  const now = nowMs / 1000;
  return (await framesOnDisk())
    .filter((t) => t <= now && now - t <= MAX_AGE_SECONDS)
    .sort((a, b) => a - b)
    .slice(-PRECIP_TYPE_FRAMES);
}

export interface RefreshStatus {
  /** A refresh is running (or was just started) — more frames may be on the way. */
  pending: boolean;
  /** Why the last refresh drew nothing, if it failed. */
  error: string | null;
}

/** Start a refresh unless one is running or one started within the last minute. */
export function refreshIfDue(nowMs: number): RefreshStatus {
  if (!state.running && nowMs - state.lastStart >= REFRESH_MS) {
    state.lastStart = nowMs;
    state.running = refresh(nowMs)
      .catch((error: unknown) => {
        state.lastError = (error as Error).message;
        console.error(`[outside] MRMS refresh failed: ${state.lastError}`);
      })
      .finally(() => {
        state.running = null;
        notify();
      });
  }
  return { pending: state.running !== null, error: state.lastError };
}

/** Resolves when the next frame is finished or the refresh ends — or after `ms`. */
export function nextFrame(ms: number): Promise<void> {
  if (!state.running) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      state.listeners.delete(done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    state.listeners.add(done);
  });
}

function notify(): void {
  for (const listener of [...state.listeners]) listener();
}

async function refresh(nowMs: number): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const have = new Set(await framesOnDisk());
  const keep: number[] = [];
  const errors: string[] = [];

  for (const time of recentFrameTimes(nowMs, CANDIDATES)) {
    if (keep.length >= PRECIP_TYPE_FRAMES) break;
    if (have.has(time)) {
      keep.push(time);
      continue;
    }
    try {
      if (await drawFrame(time)) {
        keep.push(time);
        notify();
      }
    } catch (error) {
      const message = (error as Error).message;
      errors.push(message);
      console.error(`[outside] MRMS frame ${new Date(time * 1000).toISOString()} failed: ${message}`);
    }
  }

  // Everything else goes: frames that aged out, and any half-drawn leftovers.
  for (const name of await readdir(DATA_DIR)) {
    if (!keep.includes(Number(name))) await rm(join(DATA_DIR, name), { recursive: true, force: true });
  }
  state.lastError = keep.length === 0 && errors.length > 0 ? errors[0] : null;
}

/** Decode one PNG-packed field, a band of rows at a time. */
async function decode(field: GribField): Promise<{ samples: Samples; bitDepth: number }> {
  const png = readPng(field.png);
  if (png.width !== field.grid.ni || png.height !== field.grid.nj) throw new Error("MRMS image doesn't match its grid");
  const samples = samplesOf(png, await inflateAsync(png.idat));
  for (let y = 0; y < samples.height; y += ROWS_PER_TURN) {
    unfilterRows(samples, y, Math.min(samples.height, y + ROWS_PER_TURN));
    await nextTurn();
  }
  return { samples, bitDepth: png.bitDepth };
}

function sameGrid(a: LatLonGrid, b: LatLonGrid): boolean {
  return a.ni === b.ni && a.nj === b.nj && a.la1 === b.la1 && a.lo1 === b.lo1 && a.di === b.di && a.dj === b.dj;
}

/** Fetch and draw one frame. False if NCEP doesn't have both files for it. */
async function drawFrame(time: number): Promise<boolean> {
  const [flagGz, reflGz] = await Promise.all([fetchMrmsFile("PrecipFlag", time), fetchMrmsFile("SeamlessHSR", time)]);
  if (!flagGz || !reflGz) return false;

  const flagField = parseGrib2(await gunzipAsync(flagGz));
  const reflField = parseGrib2(await gunzipAsync(reflGz));
  if (!sameGrid(flagField.grid, reflField.grid)) throw new Error("PrecipFlag and SeamlessHSR grids differ");
  const grid = flagField.grid;

  // Two images at once peak around 100 MB; each is dropped once classified.
  let flag: Awaited<ReturnType<typeof decode>> | null = await decode(flagField);
  let refl: Awaited<ReturnType<typeof decode>> | null = await decode(reflField);
  const kinds = kindTable(flagField, flag.bitDepth);
  const dbzs = dbzTable(reflField, refl.bitDepth);
  const frame = emptyCellGrid(grid);
  for (let y = 0; y < grid.nj; y += ROWS_PER_TURN) {
    packRows(flag.samples, kinds, refl.samples, dbzs, frame, y, Math.min(grid.nj, y + ROWS_PER_TURN));
    await nextTurn();
  }
  flag = null;
  refl = null;

  const tmp = join(DATA_DIR, `.tmp-${time}`);
  await rm(tmp, { recursive: true, force: true });
  await writeTiles(frame, tmp);
  const final = join(DATA_DIR, String(time));
  await rm(final, { recursive: true, force: true });
  await rename(tmp, final);
  return true;
}

async function writeTiles(frame: CellGrid, dir: string): Promise<void> {
  const tile = new Uint8Array(TILE_SIZE * TILE_SIZE);
  let batch: Promise<void>[] = [];
  for (let z = PRECIP_TYPE_MIN_ZOOM; z <= PRECIP_TYPE_MAX_NATIVE_ZOOM; z++) {
    const { x0, x1, y0, y1 } = tileRange(frame.grid, z);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        // Clear tiles aren't written; the tile route answers them with an empty one.
        if (!renderTile(frame, z, x, y, tile)) continue;
        const rows = scanlines(tile, TILE_SIZE, TILE_SIZE);
        const path = join(dir, String(z), String(x));
        batch.push(
          (async () => {
            const png = indexedPng(TILE_SIZE, TILE_SIZE, await deflateAsync(rows));
            await mkdir(path, { recursive: true });
            await writeFile(join(path, `${y}.png`), png);
          })(),
        );
        if (batch.length >= TILES_PER_TURN) {
          await Promise.all(batch);
          batch = [];
        }
      }
    }
  }
  await Promise.all(batch);
}

/** A fully transparent tile, for the parts of a frame with nothing falling. */
export const EMPTY_TILE: Uint8Array = indexedPng(1, 1, deflateSync(scanlines(new Uint8Array(1), 1, 1)));

/**
 * One tile of a frame: its PNG, `"empty"` for a clear spot in a frame that
 * exists, or null if there's no such frame (expired, or never drawn).
 */
export async function readTile(time: number, z: number, x: number, y: number): Promise<Uint8Array | "empty" | null> {
  const frame = join(DATA_DIR, String(time));
  try {
    return await readFile(join(frame, String(z), String(x), `${y}.png`));
  } catch {
    try {
      return (await stat(frame)).isDirectory() ? "empty" : null;
    } catch {
      return null;
    }
  }
}
