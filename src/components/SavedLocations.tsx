"use client";

import { useId, useState, type ReactNode } from "react";
import { categoryGlyph } from "@/lib/categories";
import { textOn } from "@/lib/color";
import { usePlaceTab, useHydrated, useSavedLocations, type PlaceTab } from "@/lib/client-store";
import { formatDateTime, formatMiles } from "@/lib/format";
import { alertsContaining, NEARBY_RADIUS_MILES, reportsNear, savedLocationStatus } from "@/lib/nearby";
import type { SavedLocation, StormAlert, StormReport } from "@/lib/types";
import { AddLocationForm } from "./AddLocationForm";
import { AlertDetail, ReportDetail } from "./Details";
import { PageHeader } from "./PageHeader";
import { PlaceForecast } from "./PlaceForecast";
import { SnowBlend } from "./SnowBlend";
import { useFilteredData } from "./providers/useFilteredData";
import { Sheet } from "./ui/Sheet";
import { tabId, tabPanelId, Tabs } from "./ui/Tabs";
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
        subtitle="Saved in this browser only. Open one for its 7-day forecast and 15-day snow blend. Used for the “saved place” notification."
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
  const ids = useId();
  const { tab, setTab } = usePlaceTab();
  const [seen, setSeen] = useState<Set<PlaceTab>>(() => new Set([tab]));
  const choose = (next: PlaceTab) => {
    setTab(next);
    setSeen((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
  };
  const [report, setReport] = useState<StormReport | null>(null);
  const point: [number, number] = [location.lat, location.lon];
  const here = alertsContaining(alerts, point);
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

      <SectionTitle>Active alerts here</SectionTitle>
      {here.length === 0 ? (
        <p className="text-sm text-muted">None.</p>
      ) : (
        <ul className="space-y-1.5">
          {here.map((w) =>
            w.isWarning ? (
              <li key={w.id}>
                <button
                  type="button"
                  onClick={() => setAlert(w)}
                  className="w-full rounded-xl px-3 py-2 text-left text-sm"
                  style={{ background: w.color, color: textOn(w.color) }}
                >
                  <span className="block font-medium">{w.event}</span>
                  {w.expires && <span className="block text-xs opacity-90">Until {formatDateTime(w.expires)}</span>}
                </button>
              </li>
            ) : (
              <li key={w.id}>
                <button
                  type="button"
                  onClick={() => setAlert(w)}
                  className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-left text-sm"
                  style={{ borderLeft: `4px solid ${w.color}` }}
                >
                  <span className="block font-medium">{w.event}</span>
                  {w.expires && <span className="block text-xs text-muted">Until {formatDateTime(w.expires)}</span>}
                </button>
              </li>
            ),
          )}
        </ul>
      )}

      <Tabs
        label="Place details"
        idPrefix={ids}
        value={tab}
        onChange={choose}
        tabs={[
          { value: "forecast", label: "7-day" },
          { value: "snow", label: "15-day snow" },
          { value: "reports", label: near.length > 0 ? `Reports (${near.length})` : "Reports" },
        ]}
        className="sticky -top-4 z-10 -mx-5 mt-5 border-b border-line-soft bg-surface px-5 py-2"
      />

      {/* Each tab mounts the first time it's opened and stays mounted, so
          switching back is instant and the snow blend's eleven model requests
          only go out for someone who looks at it. */}
      <TabPanel ids={ids} value="forecast" tab={tab} seen={seen}>
        <PlaceForecast lat={location.lat} lon={location.lon} />
      </TabPanel>
      <TabPanel ids={ids} value="snow" tab={tab} seen={seen}>
        <SnowBlend lat={location.lat} lon={location.lon} />
      </TabPanel>
      <TabPanel ids={ids} value="reports" tab={tab} seen={seen}>
        <p className="mb-1 text-xs text-muted-dim">Storm reports within {NEARBY_RADIUS_MILES} miles, matching your filters.</p>
        {near.length === 0 ? (
          <p className="text-sm text-muted">None.</p>
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
      </TabPanel>
    </Sheet>
  );
}

function TabPanel({
  ids,
  value,
  tab,
  seen,
  children,
}: {
  ids: string;
  value: PlaceTab;
  tab: PlaceTab;
  seen: Set<PlaceTab>;
  children: ReactNode;
}) {
  const active = value === tab;
  return (
    <div
      role="tabpanel"
      id={tabPanelId(ids, value)}
      aria-labelledby={tabId(ids, value)}
      hidden={!active}
      tabIndex={0}
      className="pt-3 focus-visible:outline-none"
    >
      {(active || seen.has(value)) && children}
    </div>
  );
}
