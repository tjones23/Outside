"use client";

import { formatClock, formatInches, formatSnow, formatSnowRange } from "@/lib/format";
import { BLEND_MODELS } from "@/lib/openmeteo";
import { SNOTEL_RADIUS_MILES, type SnotelReport } from "@/lib/snotel";
import type { PastDay, SnowPast as SnowPastData } from "@/lib/types";
import { usePoll } from "./providers/usePoll";
import { ErrorNote, SectionTitle } from "./ui/controls";

const MINUTE = 60 * 1000;
const NAMES = new Map(BLEND_MODELS.map((m) => [m.key, m.name]));

function dayLabel(day: PastDay): string {
  if (day.partial) return "Today";
  return new Date(`${day.date}T12:00:00`).toLocaleDateString([], { weekday: "short" });
}

const shortDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" });

/** Where the depth comes from, in one line. */
function stationLine(report: SnotelReport): string {
  const parts = [
    `${report.station.elevationFt.toLocaleString()} ft`,
    report.miles < 0.5 ? "right here" : `${report.miles} mi away`,
  ];
  if (report.at !== null) parts.push(`as of ${formatClock(report.at)}`);
  if (report.sweIn !== null) parts.push(`${formatInches(report.sweIn, 1)} of water`);
  return parts.join(" · ");
}

const COLUMNS = "grid grid-cols-[3.5rem_minmax(0,1fr)_2.75rem_3.75rem] items-center gap-x-2";

/**
 * What's on the ground and what fell over the last 15 days: the nearest
 * SNOTEL's measured depth and new snow beside the models' hindcast.
 */
export function SnowPast({ lat, lon, elevationFt }: { lat: number; lon: number; elevationFt: number | null }) {
  const url = `/api/snow-past?lat=${lat}&lon=${lon}${elevationFt !== null ? `&elev=${elevationFt}` : ""}`;
  const feed = usePoll<SnowPastData>(url, 30 * MINUTE, { whenHidden: false, refreshToken: 0 });
  const past = feed.data;

  if (!past) {
    if (feed.error) return <ErrorNote>{feed.error}</ErrorNote>;
    return <p className="py-3 text-sm text-muted-dim">Looking back at the last 15 days…</p>;
  }

  const snotel = past.snotel;
  const measured = new Map((snotel?.days ?? []).map((d) => [d.date, d.newIn]));
  const days = [...past.days].reverse();
  const max = Math.max(1, ...past.days.map((d) => d.highIn ?? d.snowIn ?? 0), ...[...measured.values()].map((v) => v ?? 0));
  const failed = past.failed.map((k) => NAMES.get(k) ?? k);

  return (
    <div className="text-sm">
      <SectionTitle>On the ground</SectionTitle>
      {snotel ? (
        <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2">
          <span className="text-2xl font-semibold tabular-nums">
            {snotel.depthIn === null ? "—" : `${Math.round(snotel.depthIn)}″`}
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block">Snow depth at {snotel.station.name}</span>
            <span className="block text-xs text-muted-dim">SNOTEL · {stationLine(snotel)}</span>
          </span>
        </div>
      ) : (
        <p className="text-muted">
          No SNOTEL station within {SNOTEL_RADIUS_MILES} miles. SNOTEL covers the western mountains; check the
          resort&rsquo;s own report for its base.
        </p>
      )}

      <SectionTitle>Past 15 days</SectionTitle>
      <div className="grid grid-cols-3 gap-2">
        {past.periods.map((p, i) => {
          const m = snotel?.periods[i];
          return (
            <div key={p.label} className="rounded-xl border border-line bg-surface-2 px-3 py-2">
              <span className="block text-xs text-muted">{p.label}</span>
              <span className="block text-xl font-semibold tabular-nums">{formatSnow(p.snowIn)}</span>
              <span className="block text-xs text-muted-dim tabular-nums">models {formatSnowRange(p)}</span>
              {m && m.newIn !== null && (
                <span className="block text-xs tabular-nums text-snow">measured {formatSnow(m.newIn)}</span>
              )}
            </div>
          );
        })}
      </div>

      <details className="mt-2">
        <summary className="cursor-pointer py-1 text-xs text-muted hover:text-text">Day by day</summary>
        <div className={`${COLUMNS} pb-1 pt-1 text-xs text-muted-dim`} aria-hidden="true">
          <span className="col-start-3 text-right">Models</span>
          <span className="text-right">{snotel ? "Measured" : "Range"}</span>
        </div>
        <ul className="divide-y divide-line-soft border-y border-line-soft">
          {days.map((day) => {
            const got = measured.get(day.date);
            const pct = (v: number | null) => (v === null ? 0 : Math.min(100, (v / max) * 100));
            return (
              <li key={day.date} className={`${COLUMNS} py-1.5`}>
                <span className="min-w-0 leading-tight">
                  <span className="block font-medium">{dayLabel(day)}</span>
                  <span className="block text-xs text-muted-dim">{shortDate(day.date)}</span>
                </span>
                <span className="relative block h-3" aria-hidden="true">
                  <span className="absolute inset-y-[5px] left-0 right-0 rounded-full bg-line-soft" />
                  {pct(day.snowIn) > 0 && (
                    <span className="absolute inset-y-0 left-0 rounded-r bg-snow/70" style={{ width: `max(${pct(day.snowIn)}%, 3px)` }} />
                  )}
                </span>
                <span className={`text-right tabular-nums ${day.snowIn ? "font-semibold" : "text-muted-dim"}`}>
                  {formatSnow(day.snowIn)}
                </span>
                <span className="text-right text-xs tabular-nums text-muted">
                  {snotel ? (got === undefined ? "—" : formatSnow(got)) : formatSnowRange(day)}
                </span>
              </li>
            );
          })}
        </ul>
      </details>

      <p className="mt-2 text-xs text-muted-dim">
        Models: what {past.loaded.map((k) => NAMES.get(k) ?? k).join(", ")} put down over their latest hours, run
        through the same rain/snow split and snow ratio as the forecast below; days run 6 AM to 6 AM.
        {snotel &&
          " Measured: the SNOTEL station's depth gains, midnight to midnight — settling makes these run low after a big storm, and a station's spot can get more or less than the slopes."}
        {failed.length > 0 && ` Missing this time: ${failed.join(", ")}.`}
        {snotel && (
          <>
            {" "}
            <a
              href={`https://wcc.sc.egov.usda.gov/nwcc/site?sitenum=${snotel.station.id.split(":")[0]}`}
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-2"
            >
              Station data by USDA NRCS
            </a>
            .
          </>
        )}
        {feed.error && ` Couldn’t refresh: ${feed.error}`}
      </p>
    </div>
  );
}
