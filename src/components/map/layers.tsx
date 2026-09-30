"use client";

import { divIcon } from "leaflet";
import { memo, type ReactNode } from "react";
import { Circle, CircleMarker, Marker, Polygon, Polyline, Popup } from "react-leaflet";
import { categoryColor, categoryGlyph } from "@/lib/categories";
import { formatDateTime } from "@/lib/format";
import type { DamageArea, LatLng, OutlookData, StormAlert, StormReport } from "@/lib/types";

/**
 * The map's vector layers. Each is memoized on its data so the radar
 * animation (which re-renders the map twice a second) never redraws them.
 */

/**
 * Popups belong in Leaflet's popup pane, above every layer. react-leaflet
 * otherwise puts a popup in the pane of the `<Pane>` it's rendered inside —
 * alongside that pane's vector layer, which covers it and takes its clicks.
 */
function MapPopup({ children }: { children: ReactNode }) {
  return <Popup pane="popupPane">{children}</Popup>;
}

function PopupButton({ onClick }: { onClick: () => void }) {
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

export const OutlookLayer = memo(function OutlookLayer({ data }: { data: OutlookData }) {
  return (
    <>
      {data.features.map((f, i) => {
        const weight = f.isHatched ? ((f.cigLevel ?? 1) >= 2 ? 3 : 2) : 1.5;
        // General thunder covers half the country; clicking it would just
        // get in the way of clicking the map.
        const interactive = !f.isGeneralThunderstorm;
        return f.rings.map((ring, j) => (
          <Polygon
            key={`o-${i}-${j}`}
            positions={ring}
            interactive={interactive}
            pathOptions={{
              color: f.strokeColor,
              weight,
              opacity: 0.9,
              fillColor: f.isHatched ? f.strokeColor : f.fillColor,
              // General thunder is a wash across half the country; keep it faint.
              fillOpacity: f.isHatched ? 0.06 : f.isGeneralThunderstorm ? 0.1 : 0.3,
              dashArray: f.isHatched ? "6 4" : undefined,
            }}
          >
            {interactive && (
              <MapPopup>
                <strong className="block">{f.detail || f.label}</strong>
                <span className="block text-muted">{data.product.title}</span>
                <a
                  href={data.product.discussionUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-1 inline-block text-accent"
                >
                  SPC discussion ↗
                </a>
              </MapPopup>
            )}
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
            pathOptions={{ color: f.strokeColor, weight: 1, opacity: 0.75 }}
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

function AlertPopup({ alert, onSelect }: { alert: StormAlert; onSelect: (a: StormAlert) => void }) {
  return (
    <MapPopup>
      <strong className="block">{alert.event}</strong>
      {alert.areaDesc && <span className="block clamp-2 text-muted">{alert.areaDesc}</span>}
      {alert.expires && <span className="block text-muted-dim">Until {formatDateTime(alert.expires)}</span>}
      <PopupButton onClick={() => onSelect(alert)} />
    </MapPopup>
  );
}

/** Warning/watch polygons, or (with `markers`) a dot at each one's center. */
export const AlertLayer = memo(function AlertLayer({
  alerts,
  onSelect,
  markers,
}: {
  alerts: StormAlert[];
  onSelect: (a: StormAlert) => void;
  markers: boolean;
}) {
  if (markers) {
    return (
      <>
        {alerts.map((a) =>
          a.centroid ? (
            <CircleMarker
              key={`ac-${a.id}`}
              center={a.centroid}
              radius={6}
              pathOptions={{ color: "#fff", weight: 1.5, fillColor: a.color, fillOpacity: 1 }}
            >
              <AlertPopup alert={a} onSelect={onSelect} />
            </CircleMarker>
          ) : null,
        )}
      </>
    );
  }
  return (
    <>
      {alerts.flatMap((a) =>
        a.polygons.map((ring, j) => (
          <Polygon
            key={`a-${a.id}-${j}`}
            positions={ring}
            pathOptions={{
              color: a.color,
              weight: a.isWatch ? 1.5 : 2.5,
              dashArray: a.isWatch ? "6 5" : undefined,
              fillColor: a.color,
              fillOpacity: a.isWatch ? 0.08 : 0.22,
            }}
          >
            <AlertPopup alert={a} onSelect={onSelect} />
          </Polygon>
        )),
      )}
    </>
  );
});

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
