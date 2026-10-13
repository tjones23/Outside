"use client";

import { formatDateTime, formatInches } from "@/lib/format";
import { dayGlyph } from "@/lib/point-forecast";
import type { ForecastDay, PointForecast } from "@/lib/types";
import { usePoll } from "./providers/usePoll";
import { ErrorNote } from "./ui/controls";

const MINUTE = 60 * 1000;

/** "Wed" for a local date string; the first row keeps NWS's "Today" or "Tonight". */
function dayLabel(day: ForecastDay, index: number): string {
  if (index === 0) return day.periods[0].isDaytime ? "Today" : "Tonight";
  return new Date(`${day.date}T12:00:00`).toLocaleDateString([], { weekday: "short" });
}

function shortDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" });
}

const temp = (t: number | null) => (t === null ? "—" : `${t}°`);

/** Snow and precipitation columns: bright when there's something, dim when there isn't. */
function Amount({ inches, decimals }: { inches: number | null; decimals: number }) {
  return (
    <span className={`text-right tabular-nums ${inches ? "font-medium text-text" : "text-muted-dim"}`}>
      {formatInches(inches, decimals)}
    </span>
  );
}

const COLUMNS = "grid grid-cols-[3.5rem_1.75rem_minmax(0,1fr)_3rem_3.25rem] items-center gap-x-2";

/** A saved place's 7-day NWS forecast, one row per day; open a row for the forecasters' wording. */
export function PlaceForecast({ lat, lon }: { lat: number; lon: number }) {
  const feed = usePoll<PointForecast>(`/api/point-forecast?lat=${lat}&lon=${lon}`, 15 * MINUTE, {
    whenHidden: false,
    refreshToken: 0,
  });
  const forecast = feed.data;

  if (!forecast) {
    if (feed.error) return <ErrorNote>{feed.error}</ErrorNote>;
    return <p className="py-3 text-sm text-muted-dim">Loading forecast…</p>;
  }
  if (forecast.days.length === 0) return <p className="text-sm text-muted">NWS has no forecast here right now.</p>;

  return (
    <div className="text-sm">
      <div className={`${COLUMNS} pb-1 text-xs text-muted-dim`} aria-hidden="true">
        <span className="col-start-4 text-right">Snow</span>
        <span className="text-right">Precip</span>
      </div>
      <ul className="divide-y divide-line-soft border-y border-line-soft">
        {forecast.days.map((day, i) => (
          <li key={`${day.date}-${day.periods[0].isDaytime ? "d" : "n"}`}>
            <details className="group">
              <summary className={`${COLUMNS} cursor-pointer list-none py-2 hover:bg-surface-2 [&::-webkit-details-marker]:hidden`}>
                <span className="min-w-0">
                  <span className="block font-medium">{dayLabel(day, i)}</span>
                  <span className="block text-xs text-muted-dim">{shortDate(day.date)}</span>
                </span>
                <span className="text-center text-lg" aria-hidden="true">
                  {dayGlyph(day)}
                </span>
                <span className="min-w-0">
                  <span className="block tabular-nums">
                    {day.high !== null && <span className="font-medium">{temp(day.high)}</span>}
                    {day.high !== null && day.low !== null && <span className="text-muted-dim"> / </span>}
                    {day.low !== null && <span className="text-muted">{temp(day.low)}</span>}
                    {day.precipChance ? <span className="text-xs text-muted"> · {day.precipChance}%</span> : null}
                  </span>
                  <span className="block truncate text-xs text-muted">{day.summary}</span>
                </span>
                <Amount inches={day.snowIn} decimals={1} />
                <Amount inches={day.precipIn} decimals={2} />
              </summary>
              <div className="space-y-2 pb-3 pt-1">
                {day.periods.map((p) => (
                  <div key={p.start}>
                    <p>
                      <span className="font-medium">{p.name}.</span> <span className="text-muted">{p.detail || p.short}</span>
                    </p>
                    {(p.snowIn !== null || p.precipIn !== null) && (
                      <p className="text-xs text-muted-dim">
                        Snow {formatInches(p.snowIn, 1)} · Precip {formatInches(p.precipIn, 2)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </details>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-dim">
        National Weather Service{forecast.updated ? `, issued ${formatDateTime(forecast.updated)}` : ""}. Each day runs 6 AM to
        6 AM, so it includes the night after. Precip is everything as water, melted snow included; — means NWS
        hasn&rsquo;t forecast amounts that far ahead.
        {forecast.amountsMissing && " Snow and precipitation amounts couldn’t be loaded this time."}
        {feed.error && ` Couldn’t refresh: ${feed.error}`}
      </p>
    </div>
  );
}
