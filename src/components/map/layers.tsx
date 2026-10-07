"use client";

import { divIcon, type LatLngExpression, type LeafletMouseEvent } from "leaflet";
import { memo, useMemo, type ReactNode } from "react";
import { Circle, CircleMarker, Marker, Polygon, Polyline, Popup } from "react-leaflet";
import { alertLevelName } from "@/lib/alert-catalog";
import { categoryColor, categoryGlyph } from "@/lib/categories";
import { formatDateTime } from "@/lib/format";
import { featureColors } from "@/lib/outlook";
import type { Theme } from "@/lib/theme";
import type { AlertLevel, DamageArea, LatLng, OutlookData, StormAlert, StormReport } from "@/lib/types";

/**
 * The map's vector layers. Each is memoized on its data so the radar
 * animation (which re-renders the map twice a second) never redraws them.
 */

/**
 * Popups belong in Leaflet's popup pane, above every layer. react-leaflet
 * otherwise puts a popup in the pane of the `<Pane>` it's rendered inside —
 * alongside that pane's vector layer, which covers it and takes its clicks.
 */
export function MapPopup({ children }: { children: ReactNode }) {
  return <Popup pane="popupPane">{children}</Popup>;
}

export function PopupButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 rounded-full border border-line bg-surface px-3 py-1 text-xs text-text hover:border-muted-dim"
    >
      Details
    </button>
  );
}

export const OutlookLayer = memo(function OutlookLayer({ data, theme }: { data: OutlookData; theme: Theme }) {
  return (
    <>
      {data.features.map((f, i) => {
        const { fill, stroke } = featureColors(f, theme);
        const weight = f.isHatched ? ((f.cigLevel ?? 1) >= 2 ? 3 : 2) : 1.5;
        return f.rings.map((ring, j) => (
          <Polygon
            key={`o-${i}-${j}`}
            positions={ring}
            pathOptions={{
              color: stroke,
              weight,
              opacity: 0.9,
              fillColor: f.isHatched ? stroke : fill,
              // General thunder is a wash across half the country; keep it faint.
              fillOpacity: f.isHatched ? 0.06 : f.isGeneralThunderstorm ? 0.1 : 0.3,
              dashArray: f.isHatched ? "6 4" : undefined,
            }}
          >
            <MapPopup>
              <strong className="block">{f.detail || f.label}</strong>
              <span className="block text-muted">
                {data.product.center} {data.product.title}
              </span>
              <a
                href={data.product.discussionUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-1 inline-block text-accent"
              >
                {data.product.center} discussion ↗
              </a>
            </MapPopup>
          </Polygon>
        ));
      })}
      {data.features
        .filter((f) => f.hatch.length > 0)
        .map((f, i) => (
          <Polyline
            key={`h-${i}`}
            positions={f.hatch}
            interactive={false}
            pathOptions={{ color: featureColors(f, theme).stroke, weight: 1, opacity: 0.75 }}
          />
        ))}
    </>
  );
});

/** Fill opacity scales with the worst report in the cluster. */
export const DamageLayer = memo(function DamageLayer({ areas }: { areas: DamageArea[] }) {
  return (
    <>
      {areas.map((area, i) => {
        const color = categoryColor(area.category);
        return (
          <Polygon
            key={`d-${i}`}
            positions={area.ring}
            interactive={false}
            pathOptions={{
              color,
              weight: 1.5,
              opacity: 0.85,
              fillColor: color,
              fillOpacity: 0.2 + area.severity * (0.68 - 0.2),
            }}
          />
        );
      })}
    </>
  );
});

/** How each tier is drawn: warnings solid and bold, watches dashed, the rest lighter. */
const LEVEL_STYLE: Record<AlertLevel, { weight: number; fillOpacity: number; dashArray?: string }> = {
  warning: { weight: 2.5, fillOpacity: 0.22 },
  watch: { weight: 1.5, fillOpacity: 0.08, dashArray: "6 5" },
  advisory: { weight: 1.5, fillOpacity: 0.16 },
  statement: { weight: 1, fillOpacity: 0.08, dashArray: "2 4" },
};

/**
 * Warning, watch and advisory polygons, or (with `markers`) a dot at the
 * middle of each storm-based warning so small ones can still be tapped.
 *
 * Zone-based alerts stack — a Heat Advisory, a Flood Watch and a Coastal
 * Flood Warning can all cover one town — so a tap doesn't open the topmost
 * polygon's popup; it reports where it landed (`onPick`), and the map lists
 * every alert there.
 */
export const AlertLayer = memo(function AlertLayer({
  alerts,
  onPick,
  markers,
}: {
  alerts: StormAlert[];
  onPick: (at: LatLng, alert?: StormAlert) => void;
  markers: boolean;
}) {
  // Least important first, so the most important draws on top.
  const ordered = useMemo(() => [...alerts].sort((a, b) => b.priority - a.priority), [alerts]);
  const handlers = useMemo(
    () => ({ click: (e: LeafletMouseEvent) => onPick([e.latlng.lat, e.latlng.lng]) }),
    [onPick],
  );

  if (markers) {
    return (
      <>
        {ordered.map((a) =>
          a.stormBased && a.isWarning && a.centroid ? (
            <CircleMarker
              key={`ac-${a.id}`}
              center={a.centroid}
              radius={6}
              pathOptions={{ color: "#fff", weight: 1.5, fillColor: a.color, fillOpacity: 1 }}
              eventHandlers={{ click: () => onPick(a.centroid!, a) }}
            />
          ) : null,
        )}
      </>
    );
  }
  return (
    <>
      {ordered.flatMap((a) =>
        a.polygons.map((ring, j) => {
          const style = LEVEL_STYLE[a.level];
          return (
            <Polygon
              key={`a-${a.id}-${j}`}
              positions={ring}
              eventHandlers={handlers}
              pathOptions={{
                color: a.color,
                weight: style.weight,
                dashArray: style.dashArray,
                fillColor: a.color,
                fillOpacity: style.fillOpacity,
              }}
            />
          );
        }),
      )}
    </>
  );
});

/** Every alert at a tapped point, most important first; tap one for its details. */
export function AlertPickPopup({
  at,
  alerts,
  onSelect,
  onClose,
}: {
  at: LatLng;
  alerts: StormAlert[];
  onSelect: (a: StormAlert) => void;
  onClose: () => void;
}) {
  const handlers = useMemo(() => ({ remove: onClose }), [onClose]);
  return (
    <Popup position={at as LatLngExpression} pane="popupPane" eventHandlers={handlers} maxWidth={300}>
      <span className="mb-1 block text-xs text-muted-dim">
        {alerts.length} alert{alerts.length === 1 ? "" : "s"} here
      </span>
      <ul className="max-h-64 space-y-1 overflow-y-auto">
        {alerts.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => onSelect(a)}
              className="flex w-full items-start gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-surface-2"
            >
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: a.color }} aria-hidden="true" />
              <span className="min-w-0">
                <strong className="block leading-snug">{a.event}</strong>
                <span className="block text-muted-dim">
                  {a.expires ? `Until ${formatDateTime(a.expires)}` : alertLevelName(a.level, false)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Popup>
  );
}

export const ReportLayer = memo(function ReportLayer({
  reports,
  onSelect,
}: {
  reports: StormReport[];
  onSelect: (r: StormReport) => void;
}) {
  return (
    <>
      {reports.map((r) => (
        <CircleMarker
          key={r.id}
          center={r.coord}
          radius={4.5}
          pathOptions={{ color: "#000", weight: 1, fillColor: categoryColor(r.category), fillOpacity: 1 }}
        >
          <MapPopup>
            <strong className="block">
              {categoryGlyph(r.category)} {r.title}
            </strong>
            <span className="block text-muted">{r.subtitle}</span>
            <PopupButton onClick={() => onSelect(r)} />
          </MapPopup>
        </CircleMarker>
      ))}
    </>
  );
});

const youAreHere = divIcon({ className: "", html: '<div class="you-are-here"></div>', iconSize: [16, 16] });

/** Past this, the halo would wash over a whole region and hide the storms under it. */
const MAX_ACCURACY_HALO_M = 25_000;

/**
 * The viewer's position: a pulsing dot, with a faint halo showing how far off
 * the fix might be. Neither takes clicks, so whatever is underneath still can.
 */
export function UserLocationMarker({ at, accuracy }: { at: LatLng; accuracy: number | null }) {
  return (
    <>
      {accuracy !== null && accuracy > 0 && accuracy <= MAX_ACCURACY_HALO_M && (
        <Circle
          center={at}
          radius={accuracy}
          interactive={false}
          pathOptions={{ color: "#3b82f6", weight: 1, opacity: 0.5, fillColor: "#3b82f6", fillOpacity: 0.12 }}
        />
      )}
      <Marker position={at} icon={youAreHere} interactive={false} keyboard={false} zIndexOffset={1000} />
    </>
  );
}
