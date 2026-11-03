import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { promisify } from "node:util";
import { deflate } from "node:zlib";
import { rgbPng } from "../mrms";
import type { WindFrame, WindModelId } from "../types";
import {
  framesToDraw,
  frameStepHours,
  imageGrid,
  parseWindGrib,
  recentRuns,
  windFrameUrl,
  windImage,
  windModel,
  WIND_MODELS,
  WIND_RENDER_VERSION,
  type WindScale,
} from "../wind";
import { fetchWindFile, fetchWindRunPublished } from "./upstream";

/**
 * Wind frames, drawn on this server and kept on disk, one folder per model.
 *
 * Like the rain/snow radar, nothing runs on a timer: each poll of
 * `/api/wind` calls `refreshIfDue`, which at most every ten minutes looks for
 * a newer run and, if there is one, redraws the frames from now on from it,
 * nearest first. Frames already drawn from that run are kept, frames behind
 * now are deleted, and frames past the new run's last hour stay until they
 * age out. So the downloads happen only while someone has wind open.
 *
 * Each frame is `<valid time>-<run>.png` with a `.json` of the same name
 * holding its scale; the JSON is written last, so a frame without one is
 * unfinished and is never listed. Naming by run means a newer run never
 * overwrites an image a browser is still asking for under the older run's
 * scale: the old file just goes, and its URL answers 404 until the next poll.
 */

const DATA_ROOT = join(process.cwd(), ".outside", "wind");
/** Frames drawn by this version of the renderer; anything else under DATA_ROOT is stale. */
const DATA_DIR = join(DATA_ROOT, `v${WIND_RENDER_VERSION}`);
/** How often a refresh may go back to NOMADS; polls in between just read the disk. */
const REFRESH_MS = 10 * 60_000;
/** Runs checked per refresh, newest first: the newest is usually not finished yet. */
const CANDIDATE_RUNS = 3;

const deflateAsync = promisify(deflate);

interface FrameMeta extends WindScale {
  run: number;
}

const FRAME_FILE = /^(\d{10})-(\d{10})\.(png|json)$/;
const frameName = (time: number, run: number) => `${time}-${run}`;

interface State {
  running: Promise<void> | null;
  lastStart: number;
  lastError: string | null;
  /** Called whenever a frame is finished. */
  listeners: Set<() => void>;
}

// One per model per process, kept on globalThis so a dev-server reload of
// this module doesn't start a second refresh beside the first.
const g = globalThis as { __outsideWind?: Record<WindModelId, State> };
const states: Record<WindModelId, State> = (g.__outsideWind ??= Object.fromEntries(
  WIND_MODELS.map((m) => [m.id, { running: null, lastStart: 0, lastError: null, listeners: new Set() }]),
) as Record<WindModelId, State>);

const modelDir = (model: WindModelId) => join(DATA_DIR, model);

async function readMeta(model: WindModelId, time: number, run: number): Promise<FrameMeta | null> {
  try {
    const scale = JSON.parse(await readFile(join(modelDir(model), `${frameName(time, run)}.json`), "utf8")) as WindScale;
    return { run, ...scale };
  } catch {
    return null;
  }
}

/** Each valid time's newest finished frame. */
async function framesOnDisk(model: WindModelId): Promise<Map<number, FrameMeta>> {
  let names: string[];
  try {
    names = await readdir(modelDir(model));
  } catch {
    return new Map();
  }
  const newest = new Map<number, number>();
  for (const name of names) {
    const m = FRAME_FILE.exec(name);
    if (m?.[3] !== "json") continue;
    const time = Number(m[1]), run = Number(m[2]);
    if (run > (newest.get(time) ?? 0)) newest.set(time, run);
  }
  const metas = await Promise.all([...newest].map(async ([t, run]) => [t, await readMeta(model, t, run)] as const));
  return new Map(metas.filter((m): m is readonly [number, FrameMeta] => m[1] !== null));
}

/** Frames from the one just past onward, oldest first. */
export async function availableFrames(model: WindModelId, nowMs: number): Promise<WindFrame[]> {
  const oldest = nowMs / 1000 - frameStepHours(windModel(model)) * 3600;
  return [...(await framesOnDisk(model))]
    .filter(([time]) => time > oldest)
    .sort((a, b) => a[0] - b[0])
    .map(([time, m]) => ({
      time,
      run: m.run,
      url: windFrameUrl(model, time, m.run),
      uMin: m.uMin,
      uMax: m.uMax,
      vMin: m.vMin,
      vMax: m.vMax,
    }));
}

export interface RefreshStatus {
  /** A refresh is running (or was just started) — more frames may be on the way. */
  pending: boolean;
  /** Why the last refresh drew nothing, if it failed. */
  error: string | null;
}

/** Start a refresh unless one is running or one started within the last ten minutes. */
export function refreshIfDue(model: WindModelId, nowMs: number): RefreshStatus {
  const state = states[model];
  if (!state.running && nowMs - state.lastStart >= REFRESH_MS) {
    state.lastStart = nowMs;
    state.running = refresh(model, nowMs)
      .catch((error: unknown) => {
        state.lastError = (error as Error).message;
        console.error(`[outside] ${model} wind refresh failed: ${state.lastError}`);
      })
      .finally(() => {
        state.running = null;
        notify(model);
      });
  }
  return { pending: state.running !== null, error: state.lastError };
}

/** Resolves when the next frame is finished or the refresh ends — or after `ms`. */
export function nextFrame(model: WindModelId, ms: number): Promise<void> {
  const state = states[model];
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

function notify(model: WindModelId): void {
  for (const listener of [...states[model].listeners]) listener();
}

/** The newest run NCEP has finished, or null if none of the last few has. */
async function newestRun(model: WindModelId, nowMs: number): Promise<number | null> {
  for (const run of recentRuns(windModel(model), nowMs, CANDIDATE_RUNS)) {
    if (await fetchWindRunPublished(model, run)) return run;
  }
  return null;
}

async function refresh(model: WindModelId, nowMs: number): Promise<void> {
  const dir = modelDir(model);
  await mkdir(dir, { recursive: true });
  // Frames drawn by an older renderer would be reused as they are, so they go first.
  for (const name of await readdir(DATA_ROOT)) {
    if (join(DATA_ROOT, name) !== DATA_DIR) await rm(join(DATA_ROOT, name), { recursive: true, force: true });
  }

  const run = await newestRun(model, nowMs);
  const have = await framesOnDisk(model);
  const errors: string[] = [];
  let drawn = 0;
  if (run !== null) {
    for (const { hour, time } of framesToDraw(windModel(model), run, nowMs)) {
      if ((have.get(time)?.run ?? 0) >= run) continue;
      try {
        const meta = await drawFrame(model, run, hour, time);
        if (meta) {
          have.set(time, meta);
          drawn++;
          notify(model);
        }
      } catch (error) {
        const message = (error as Error).message;
        errors.push(message);
        console.error(`[outside] ${model} wind ${new Date(run * 1000).toISOString()} f${hour} failed: ${message}`);
      }
      await nextTurn();
    }
  }

  // Frames behind now go, and so do older runs' frames and anything half-written.
  const oldest = nowMs / 1000 - frameStepHours(windModel(model)) * 3600;
  for (const name of await readdir(dir)) {
    const m = FRAME_FILE.exec(name);
    const time = Number(m?.[1]);
    const current = m !== null && have.get(time)?.run === Number(m[2]);
    if (!current || time <= oldest) await rm(join(dir, name), { force: true });
  }

  const shown = [...have.keys()].filter((t) => t > oldest).length;
  if (run === null && shown === 0) throw new Error(`no ${windModel(model).name} run is published yet`);
  states[model].lastError = shown === 0 && drawn === 0 && errors.length > 0 ? errors[0] : null;
}

/** Fetch and draw one frame. Null if NOMADS doesn't have the file. */
async function drawFrame(model: WindModelId, run: number, hour: number, time: number): Promise<FrameMeta | null> {
  const file = await fetchWindFile(model, run, hour);
  if (!file) return null;
  const field = parseWindGrib(file);
  if (field.run !== run || field.hour !== hour) throw new Error(`NOMADS sent run ${field.run} f${field.hour}`);
  const image = windImage(field, imageGrid(windModel(model)));
  const png = rgbPng(image.width, image.height, await deflateAsync(image.scanlines));
  const meta: FrameMeta = { run, ...image.scale };

  const dir = modelDir(model);
  const write = async (name: string, data: Uint8Array | string) => {
    const tmp = join(dir, `.tmp-${name}`);
    await writeFile(tmp, data);
    await rename(tmp, join(dir, name));
  };
  await write(`${frameName(time, run)}.png`, png);
  await write(`${frameName(time, run)}.json`, JSON.stringify(image.scale));
  return meta;
}

/** One frame's PNG, or null if there's no such frame (expired, replaced, or never drawn). */
export async function readFrame(model: WindModelId, time: number, run: number): Promise<Uint8Array | null> {
  try {
    return await readFile(join(modelDir(model), `${frameName(time, run)}.png`));
  } catch {
    return null;
  }
}
