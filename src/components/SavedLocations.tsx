"use client";

import { useState } from "react";
import { categoryGlyph } from "@/lib/categories";
import { useHydrated, useSavedLocations } from "@/lib/client-store";
import { formatDateTime, formatMiles } from "@/lib/format";
import { NEARBY_RADIUS_MILES, reportsNear, savedLocationStatus, warningsContaining } from "@/lib/nearby";
import type { SavedLocation, StormAlert, StormReport } from "@/lib/types";
import { AddLocationForm } from "./AddLocationForm";
import { AlertDetail, ReportDetail } from "./Details";
import { PageHeader } from "./PageHeader";
import { useFilteredData } from "./providers/useFilteredData";
import { Sheet } from "./ui/Sheet";
import { Button, EmptyState, SectionTitle } from "./ui/controls";

/** Saved places, each with a one-line storm status (the mobile app's list). */
export function SavedLocations() {
  const { locations, remove } = useSavedLocations();
  const { allAlerts, reports } = useFilteredData();
  const hydrated = useHydrated();
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = locations.find((l) => l.id === openId) ?? null;

  return (
    <>
      <PageHeader
        title="Places"
        subtitle="Saved in this browser only. Used for the “saved place” notification."
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            Add place
          </Button>
        }
      />

      {!hydrated ? null : locations.length === 0 ? (
        <EmptyState title="No saved places">
          Save home, work or family to see at a glance when a warning covers them or storms were reported nearby.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line-soft overflow-hidden rounded-2xl border border-line bg-surface">
          {locations.map((loc) => {
            const status = savedLocationStatus(loc, allAlerts, reports);
            return (
              <li key={loc.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(loc.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{loc.name}</span>
                    <span
                      className={`block text-sm ${
                        status.tone === "reports" ? "text-watch" : status.tone === "quiet" ? "text-muted-dim" : ""
                      }`}
                      style={status.color ? { color: status.color } : undefined}
                    >
                      {status.label}
                    </span>
                  </span>
                  <span className="text-muted-dim" aria-hidden="true">
                    ›
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {adding && <AddLocationForm onClose={() => setAdding(false)} />}
      {open && (
        <LocationDetail
          location={open}
          alerts={allAlerts}
          reports={reports}
          onRemove={() => {
            remove(open.id);
            setOpenId(null);
          }}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}

function LocationDetail({
  location,
  alerts,
  reports,
  onRemove,
  onClose,
}: {
  location: SavedLocation;
  alerts: StormAlert[];
  reports: StormReport[];
  onRemove: () => void;
  onClose: () => void;
}) {
  const [alert, setAlert] = useState<StormAlert | null>(null);
  const [report, setReport] = useState<StormReport | null>(null);
  const point: [number, number] = [location.lat, location.lon];
  const warnings = warningsContaining(alerts, point);
  const near = reportsNear(reports, point);

  if (alert) return <AlertDetail alert={alert} onClose={() => setAlert(null)} />;
  if (report) return <ReportDetail report={report} onClose={() => setReport(null)} />;

  return (
    <Sheet
      title={location.name}
      onClose={onClose}
      actions={
        <Button variant="danger" onClick={onRemove} className="px-3 py-1">
          Remove
        </Button>
      }
    >
      <p className="text-xs text-muted-dim">
        {location.lat.toFixed(3)}, {location.lon.toFixed(3)}
      </p>

      <SectionTitle>Active warnings here</SectionTitle>
      {warnings.length === 0 ? (
        <p className="text-sm text-muted">None.</p>
      ) : (
        <ul className="space-y-1.5">
          {warnings.map((w) => (
            <li key={w.id}>
              <button
                type="button"
                onClick={() => setAlert(w)}
                className="w-full rounded-xl px-3 py-2 text-left text-sm text-white"
                style={{ background: w.color }}
              >
                <span className="block font-medium">{w.event}</span>
                {w.expires && <span className="block text-xs opacity-90">Until {formatDateTime(w.expires)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      <SectionTitle>Reports within {NEARBY_RADIUS_MILES} mi</SectionTitle>
      {near.length === 0 ? (
        <p className="text-sm text-muted">None match your filters.</p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {near.map(({ report: r, miles }) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setReport(r)}
                className="flex w-full items-baseline gap-2 py-2 text-left text-sm hover:text-accent"
              >
                <span aria-hidden="true">{categoryGlyph(r.category)}</span>
                <span className="min-w-0 flex-1 truncate">
                  {r.title} <span className="text-muted-dim">· {r.location}</span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted">{formatMiles(miles)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
