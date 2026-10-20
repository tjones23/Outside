"use client";

import { useId, useState, type ReactNode } from "react";
import { categoryGlyph } from "@/lib/categories";
import { textOn } from "@/lib/color";
import { usePlaceTab, type PlaceTab } from "@/lib/client-store";
import { formatDateTime, formatMiles } from "@/lib/format";
import { alertsContaining, NEARBY_RADIUS_MILES, reportsNear } from "@/lib/nearby";
import { midFt, type Resort } from "@/lib/resorts";
import type { StormAlert, StormReport } from "@/lib/types";
import { AlertDetail, ReportDetail } from "./Details";
import { PassBadge } from "./PassBadge";
import { PlaceForecast } from "./PlaceForecast";
import { SnowBlend } from "./SnowBlend";
import { SnowPast } from "./SnowPast";
import { Sheet } from "./ui/Sheet";
import { tabId, tabPanelId, Tabs } from "./ui/Tabs";
import { SectionTitle } from "./ui/controls";

export interface PlacePoint {
  name: string;
  lat: number;
  lon: number;
}

const feet = (ft: number) => `${ft.toLocaleString()} ft`;

/**
 * One place, opened: active alerts pinned on top, then the 7-day forecast,
 * snow (past, on the ground, and the 15-day blend) and nearby storm reports
 * as tabs. Used for saved places, where you are, and ski resorts.
 */
export function PlaceSheet({
  place,
  resort,
  alerts,
  reports,
  actions,
  onClose,
}: {
  place: PlacePoint;
  /** Set for a ski resort, saved or not. */
  resort?: Resort | null;
  alerts: StormAlert[];
  reports: StormReport[];
  actions?: ReactNode;
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
  const point: [number, number] = [place.lat, place.lon];
  const here = alertsContaining(alerts, point);
  const near = reportsNear(reports, point);

  if (alert) return <AlertDetail alert={alert} onClose={() => setAlert(null)} />;
  if (report) return <ReportDetail report={report} onClose={() => setReport(null)} />;

  return (
    <Sheet title={place.name} onClose={onClose} actions={actions}>
      {resort ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-dim">
          <PassBadge pass={resort.pass} />
          {resort.baseFt !== null && resort.topFt !== null && (
            <span>
              {feet(resort.baseFt)} – {feet(resort.topFt)}
            </span>
          )}
          {resort.website && (
            <a
              href={resort.website}
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-2 hover:text-text"
            >
              Resort website ↗
            </a>
          )}
          {resort.webcams && (
            <a
              href={resort.webcams}
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-2 hover:text-text"
            >
              Webcams ↗
            </a>
          )}
        </p>
      ) : (
        <p className="text-xs text-muted-dim">
          {place.lat.toFixed(3)}, {place.lon.toFixed(3)}
        </p>
      )}

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
          { value: "snow", label: "Snow" },
          { value: "reports", label: near.length > 0 ? `Reports (${near.length})` : "Reports" },
        ]}
        className="sticky -top-4 z-10 -mx-5 mt-5 border-b border-line-soft bg-surface px-5 py-2"
      />

      {/* Each tab mounts the first time it's opened and stays mounted, so
          switching back is instant and the snow tab's model requests only go
          out for someone who looks at it. */}
      <TabPanel ids={ids} value="forecast" tab={tab} seen={seen}>
        <PlaceForecast lat={place.lat} lon={place.lon} />
      </TabPanel>
      <TabPanel ids={ids} value="snow" tab={tab} seen={seen}>
        <SnowPast lat={place.lat} lon={place.lon} elevationFt={resort ? midFt(resort) : null} />
        <SectionTitle>Next 15 days</SectionTitle>
        <SnowBlend lat={place.lat} lon={place.lon} />
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
