"use client";

import { useMemo, useState } from "react";
import { sortAlerts, type AlertSort } from "@/lib/alerts";
import { formatDateTime } from "@/lib/format";
import type { StormAlert } from "@/lib/types";
import { AlertDetail } from "./Details";
import { AlertKindChips } from "./FilterChips";
import { FiltersPanel } from "./FiltersPanel";
import { PageHeader } from "./PageHeader";
import { useLocation } from "./providers/LocationProvider";
import { useStormData } from "./providers/StormDataProvider";
import { useFilteredData } from "./providers/useFilteredData";
import { Button, Chip, EmptyState, ErrorNote } from "./ui/controls";

const SORTS: { mode: AlertSort; label: string }[] = [
  { mode: "recent", label: "Recent" },
  { mode: "severity", label: "Severity" },
  { mode: "distance", label: "Distance" },
];

/** Active NWS warnings and watches. */
export function AlertsList() {
  const { alerts } = useFilteredData();
  const { alerts: feed } = useStormData();
  const location = useLocation();
  const [sort, setSort] = useState<AlertSort>("recent");
  const [ascending, setAscending] = useState(false);
  const [selected, setSelected] = useState<StormAlert | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const sorted = useMemo(
    () => sortAlerts(alerts, sort, ascending, location.coord),
    [alerts, sort, ascending, location.coord],
  );

  const choose = async (mode: AlertSort) => {
    if (mode === "distance" && !location.coord && !(await location.request())) return;
    if (mode === sort) setAscending((a) => !a);
    else {
      setSort(mode);
      setAscending(false);
    }
  };

  const warnings = alerts.filter((a) => a.isWarning).length;

  return (
    <>
      <PageHeader
        title="Alerts"
        subtitle={`${warnings} warning${warnings === 1 ? "" : "s"} · ${alerts.length - warnings} watch${
          alerts.length - warnings === 1 ? "" : "es"
        } from the National Weather Service`}
        actions={<Button onClick={() => setShowFilters(true)}>Filters</Button>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <AlertKindChips />
        <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
        {SORTS.map(({ mode, label }) => (
          <Chip
            key={mode}
            on={sort === mode}
            onClick={() => void choose(mode)}
            title={mode === "distance" && !location.available ? "Needs the HTTPS address" : undefined}
          >
            {label}
            {sort === mode && <span aria-label={ascending ? "ascending" : "descending"}>{ascending ? "▲" : "▼"}</span>}
          </Chip>
        ))}
      </div>

      {location.error && sort !== "distance" && <p className="mb-3 text-sm text-muted-dim">{location.error}</p>}
      {feed.error && <div className="mb-3"><ErrorNote>{feed.error}</ErrorNote></div>}

      {sorted.length === 0 ? (
        feed.loading && !feed.data ? (
          <p className="py-12 text-center text-sm text-muted-dim">Loading alerts…</p>
        ) : (
          <EmptyState title="No active alerts">
            No tornado or severe thunderstorm warnings or watches right now{alerts.length === 0 && feed.data?.alerts.length ? " that match your filters" : ""}.
          </EmptyState>
        )
      ) : (
        <ul className="space-y-2">
          {sorted.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => setSelected(a)}
                className="flex w-full overflow-hidden rounded-2xl border border-line bg-surface text-left transition-colors hover:bg-surface-2"
              >
                <span className="w-1.5 shrink-0" style={{ background: a.color }} aria-hidden="true" />
                <span className="min-w-0 flex-1 px-4 py-3">
                  <span className="flex items-baseline gap-2">
                    <span className="font-medium">{a.event}</span>
                    {a.expires && (
                      <span className="ml-auto shrink-0 text-xs text-muted-dim">
                        Until {formatDateTime(a.expires)}
                      </span>
                    )}
                  </span>
                  {a.areaDesc && <span className="clamp-2 mt-0.5 block text-sm text-muted">{a.areaDesc}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {showFilters && <FiltersPanel onClose={() => setShowFilters(false)} />}
      {selected && <AlertDetail alert={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
