"use client";

import { useMemo, useState } from "react";
import { CATEGORIES, categoryColor, categoryGlyph, categoryName } from "@/lib/categories";
import { formatMiles, formatUtcTime } from "@/lib/format";
import { REPORT_RADIUS_OPTIONS, reportsWithin } from "@/lib/nearby";
import { dayLabel } from "@/lib/reports";
import type { StormReport } from "@/lib/types";
import { ReportDetail } from "./Details";
import { CategoryChips } from "./FilterChips";
import { FiltersPanel } from "./FiltersPanel";
import { PageHeader } from "./PageHeader";
import { useLocation } from "./providers/LocationProvider";
import { useStormData } from "./providers/StormDataProvider";
import { useFilteredData } from "./providers/useFilteredData";
import { useNow } from "./providers/useNow";
import { Button, Chip, EmptyState, ErrorNote } from "./ui/controls";

type Radius = (typeof REPORT_RADIUS_OPTIONS)[number];

/** SPC storm reports, newest first, optionally limited to a radius around you. */
export function ReportsList() {
  const { reports, filters } = useFilteredData();
  const { reports: feed } = useStormData();
  const location = useLocation();
  const now = useNow();
  const [radius, setRadius] = useState<Radius>(null);
  const [selected, setSelected] = useState<StormReport | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const rows = useMemo(() => {
    if (radius !== null && location.coord) {
      return reportsWithin(reports, location.coord, radius);
    }
    // Newest first: by convective day, then by time. SPC times after midnight
    // UTC (0000–1159) belong to the end of the day, so shift them past 2400.
    const order = (r: StormReport) => {
      const t = Number(r.time) || 0;
      return t < 1200 ? t + 2400 : t;
    };
    return [...reports]
      .sort((a, b) => b.date.localeCompare(a.date) || order(b) - order(a))
      .map((report) => ({ report, miles: null as number | null }));
  }, [reports, radius, location.coord]);

  const counts = CATEGORIES.map((c) => [c, reports.filter((r) => r.category === c).length] as const);

  const cycleRadius = async () => {
    const i = REPORT_RADIUS_OPTIONS.indexOf(radius);
    const next = REPORT_RADIUS_OPTIONS[(i + 1) % REPORT_RADIUS_OPTIONS.length];
    if (next !== null && !location.coord && !(await location.request())) return;
    setRadius(next);
  };

  const failedDays = feed.data?.days.filter((d) => !d.ok) ?? [];

  return (
    <>
      <PageHeader
        title="Storm reports"
        subtitle={`Preliminary reports from SPC · ${filters.reportDays === 1 ? "today" : `last ${filters.reportDays} days`}`}
        actions={
          <Button onClick={() => setShowFilters(true)} variant="secondary">
            Filters
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <CategoryChips />
        <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
        <Chip
          on={radius !== null}
          onClick={() => void cycleRadius()}
          title={location.available ? "Limit to a distance from you" : "Needs the HTTPS address"}
        >
          {radius === null ? "Anywhere" : `Within ${radius} mi`}
        </Chip>
      </div>

      <div className="mb-4 flex flex-wrap gap-4 text-sm text-muted">
        {counts.map(([c, n]) => (
          <span key={c} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: categoryColor(c) }} />
            {n} {categoryName(c).toLowerCase()}
          </span>
        ))}
      </div>

      {location.error && radius === null && (
        <p className="mb-3 text-sm text-muted-dim">{location.error}</p>
      )}
      {feed.error && <div className="mb-3"><ErrorNote>{feed.error}</ErrorNote></div>}
      {failedDays.length > 0 && (
        <p className="mb-3 text-sm text-watch">
          Some days didn&apos;t load: {failedDays.map((d) => dayLabel(d.date, new Date(now))).join(", ")}.
        </p>
      )}

      {rows.length === 0 ? (
        feed.loading && !feed.data ? (
          <p className="py-12 text-center text-sm text-muted-dim">Loading reports…</p>
        ) : (
          <EmptyState title="No reports">
            {radius !== null ? `Nothing within ${radius} miles. ` : ""}Quiet weather, or your filters are hiding them.
          </EmptyState>
        )
      ) : (
        <ul className="divide-y divide-line-soft overflow-hidden rounded-2xl border border-line bg-surface">
          {rows.map(({ report: r, miles }) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setSelected(r)}
                className="flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
              >
                <span className="text-xl leading-none" aria-hidden="true">
                  {categoryGlyph(r.category)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="font-medium">{r.title}</span>
                    <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-dim">
                      {miles !== null ? `${formatMiles(miles)} · ` : ""}
                      {dayLabel(r.date, new Date(now))} {formatUtcTime(r.time).replace(" UTC", "Z")}
                    </span>
                  </span>
                  <span className="block text-sm text-muted">{r.subtitle}</span>
                  {r.comments && <span className="clamp-2 mt-0.5 block text-xs text-muted-dim">{r.comments}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {showFilters && <FiltersPanel onClose={() => setShowFilters(false)} />}
      {selected && <ReportDetail report={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
