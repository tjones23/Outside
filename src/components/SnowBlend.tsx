"use client";

import { formatInches, formatSnow, formatSnowRange } from "@/lib/format";
import { BLEND_MODELS, OPEN_METEO_ATTRIBUTION } from "@/lib/openmeteo";
import type { BlendDay, BlendModelTotal, BlendSpan, SnowBlend as SnowBlendData } from "@/lib/types";
import { usePoll } from "./providers/usePoll";
import { ErrorNote } from "./ui/controls";

const MINUTE = 60 * 1000;
const NAMES = new Map(BLEND_MODELS.map((m) => [m.key, m]));

function dayLabel(day: BlendDay, index: number): string {
  if (index === 0) return day.nightOnly ? "Tonight" : "Today";
  return new Date(`${day.date}T12:00:00`).toLocaleDateString([], { weekday: "short" });
}

const shortDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" });

const range = formatSnowRange;
const snow = formatSnow;

/**
 * The blend as a bar and the models' spread as a faint track behind it, all
 * rows on one scale so days compare at a glance.
 */
function SnowBar({ span, max }: { span: BlendSpan; max: number }) {
  const pct = (v: number | null) => (v === null || max <= 0 ? 0 : Math.min(100, (v / max) * 100));
  const lo = pct(span.lowIn);
  const hi = pct(span.highIn);
  const value = pct(span.snowIn);
  return (
    <span
      className="relative block h-3"
      title={`Blend ${snow(span.snowIn)} · models ${range(span)}`}
      aria-hidden="true"
    >
      <span className="absolute inset-y-[5px] left-0 right-0 rounded-full bg-line-soft" />
      {hi > lo && (
        <span className="absolute inset-y-1 rounded-full bg-snow/30" style={{ left: `${lo}%`, width: `${hi - lo}%` }} />
      )}
      {value > 0 && (
        <span className="absolute inset-y-0 left-0 rounded-r bg-snow" style={{ width: `max(${value}%, 3px)` }} />
      )}
    </span>
  );
}

function ModelLine({ total }: { total: BlendModelTotal }) {
  const model = NAMES.get(total.key);
  return (
    <li className="flex items-baseline gap-2">
      <span className="min-w-0 flex-1 truncate">
        {model?.name ?? total.key}
        <span className="text-muted-dim"> · {model?.maker}</span>
      </span>
      {total.p10In !== undefined && total.p90In !== undefined && (
        <span className="text-xs text-muted-dim">
          {total.members} runs, {snow(total.p10In)}–{snow(total.p90In)} · mean
        </span>
      )}
      <span className="w-12 text-right tabular-nums">{snow(total.snowIn)}</span>
    </li>
  );
}

const COLUMNS = "grid grid-cols-[3.5rem_minmax(0,1fr)_2.75rem_3.75rem] items-center gap-x-2";

/** A saved place's 15-day snow forecast, blended from every model Outside reads. */
export function SnowBlend({ lat, lon }: { lat: number; lon: number }) {
  const feed = usePoll<SnowBlendData>(`/api/snow-blend?lat=${lat}&lon=${lon}`, 30 * MINUTE, {
    whenHidden: false,
    refreshToken: 0,
  });
  const blend = feed.data;

  if (!blend) {
    if (feed.error) return <ErrorNote>{feed.error}</ErrorNote>;
    return <p className="py-3 text-sm text-muted-dim">Blending the models…</p>;
  }

  const max = Math.max(1, ...blend.days.map((d) => Math.max(d.highIn ?? 0, d.snowIn ?? 0)));
  const failed = blend.failed.map((k) => NAMES.get(k)?.name ?? k);

  return (
    <div className="text-sm">
      {blend.periods.length > 0 && (
        <div className="mb-3 grid grid-cols-3 gap-2">
          {blend.periods.map((p) => (
            <div key={p.label} className="rounded-xl border border-line bg-surface-2 px-3 py-2">
              <span className="block text-xs text-muted">{p.label}</span>
              <span className="block text-xl font-semibold tabular-nums">{snow(p.snowIn)}</span>
              <span className="block text-xs text-muted-dim tabular-nums">{range(p)}</span>
            </div>
          ))}
        </div>
      )}

      <div className={`${COLUMNS} pb-1 text-xs text-muted-dim`} aria-hidden="true">
        <span className="col-start-3 text-right">Snow</span>
        <span className="text-right">Range</span>
      </div>
      <ul className="divide-y divide-line-soft border-y border-line-soft">
        {blend.days.map((day, i) => (
          <li key={`${day.date}-${day.nightOnly ? "n" : "d"}`}>
            <details>
              <summary className={`${COLUMNS} cursor-pointer list-none py-1.5 hover:bg-surface-2 [&::-webkit-details-marker]:hidden`}>
                <span className="min-w-0 leading-tight">
                  <span className="block font-medium">{dayLabel(day, i)}</span>
                  <span className="block text-xs text-muted-dim">{shortDate(day.date)}</span>
                </span>
                <SnowBar span={day} max={max} />
                <span className={`text-right tabular-nums ${day.snowIn ? "font-semibold" : "text-muted-dim"}`}>
                  {snow(day.snowIn)}
                </span>
                <span className="text-right text-xs tabular-nums text-muted">{range(day)}</span>
              </summary>
              <div className="space-y-2 pb-3 pt-1">
                <p className="text-xs text-muted">
                  {!day.nightOnly && <>Day {snow(day.dayIn)} · </>}Night {snow(day.nightIn)}
                  {day.ratio !== null && <> · {day.ratio}:1 snow ratio</>}
                  {day.precipIn !== null && <> · {formatInches(day.precipIn, 2)} water</>}
                  {(day.high !== null || day.low !== null) && (
                    <> · {day.high !== null ? `${day.high}°` : "—"} / {day.low !== null ? `${day.low}°` : "—"}</>
                  )}
                </p>
                <ul className="space-y-0.5 text-xs">
                  {day.models.map((m) => (
                    <ModelLine key={m.key} total={m} />
                  ))}
                </ul>
              </div>
            </details>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-xs text-muted-dim">
        {blend.loaded.length} models blended, weighted by how well each does at each range; each one&rsquo;s rain
        and snow is split and its snow ratio worked out from its own temperatures through the air above this spot
        {blend.elevationM !== null && ` (${Math.round(blend.elevationM * 3.281).toLocaleString()} ft)`}. The range
        runs from the lowest to the highest model. Tap a day for each model.
        {failed.length > 0 && ` Missing this time: ${failed.join(", ")}.`}{" "}
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">
          {OPEN_METEO_ATTRIBUTION}
        </a>
        .{feed.error && ` Couldn’t refresh: ${feed.error}`}
      </p>
    </div>
  );
}
