"use client";

import { divIcon, type LatLngExpression } from "leaflet";
import { memo, useCallback, useMemo, useState } from "react";
import { CircleMarker, Marker, Polygon, Popup, useMapEvents } from "react-leaflet";
import { formatDateTime } from "@/lib/format";
import { smokeStyle } from "@/lib/smoke";
import type { Hotspot, SmokePlume, WildfireIncident, WildfirePerimeter } from "@/lib/types";
import {
  containmentBand,
  containmentColor,
  containmentText,
  fireMarkerSize,
  formatAcres,
  hotspotColor,
  satelliteName,
} from "@/lib/wildfire";
import { MapPopup, PopupButton } from "./layers";

/**
 * Wildfire layers, each in its own pane (see `StormMap`):
 *
 * - `SmokeLayer`, low down: HMS plumes, faint and not clickable — they span
 *   states, and the warnings above them need the clicks.
 * - `PerimeterLayer`, just above the warnings: each fire's mapped outline,
 *   colored by its containment.
 * - `HotspotLayer`, above the labels: the last day's VIIRS detections.
 * - `FireLayer`, above that: a dot where each fire started, sized by acres.
 */

export const SmokeLayer = memo(function SmokeLayer({ plumes }: { plumes: SmokePlume[] }) {
  return (
    <>
      {plumes.flatMap((plume, i) => {
        const style = smokeStyle(plume.density);
        return plume.rings.map((ring, j) => (
          <Polygon
            key={`s-${i}-${j}`}
            positions={ring}
            interactive={false}
            pathOptions={{
              color: style.color,
              weight: 1,
              opacity: 0.5,
              fillColor: style.color,
              fillOpacity: style.fillOpacity,
            }}
          />
        ));
      })}
    </>
  );
});

export const PerimeterLayer = memo(function PerimeterLayer({
  perimeters,
  incidents,
  onSelect,
}: {
  perimeters: WildfirePerimeter[];
  incidents: WildfireIncident[];
  onSelect: (fire: WildfireIncident) => void;
}) {
  const byId = useMemo(() => new Map(incidents.map((f) => [f.id, f])), [incidents]);
  return (
    <>
      {perimeters.map((p) => {
        const fire = byId.get(p.id);
        const color = containmentColor(fire?.contained ?? null);
        return p.rings.map((ring, j) => (
          <Polygon
            key={`p-${p.id}-${j}`}
            positions={ring}
            pathOptions={{ color, weight: 1.5, opacity: 0.95, fillColor: color, fillOpacity: 0.25 }}
          >
            <MapPopup>
              <strong className="block">{fire?.name ?? p.name}</strong>
              <span className="block text-muted">
                {[formatAcres(p.acres ?? fire?.acres ?? null), fire && containmentText(fire.contained)]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <span className="block text-muted-dim">Perimeter mapped {formatDateTime(p.mapped)}</span>
              {fire && <PopupButton onClick={() => onSelect(fire)} />}
            </MapPopup>
          </Polygon>
        ));
      })}
    </>
  );
});

const fireIcons = new Map<string, ReturnType<typeof divIcon>>();

/**
 * Zoomed out to the whole country, a few hundred fires would bury the West;
 * dots shrink below zoom 6.
 */
function zoomScale(zoom: number): number {
  return zoom >= 6 ? 1 : zoom >= 5 ? 0.8 : 0.6;
}

/** A colored dot, sized by acres and zoom; active fires get a glow. */
function fireIcon(fire: WildfireIncident, scale: number) {
  const size = Math.max(5, Math.round(fireMarkerSize(fire.acres) * scale));
  const band = containmentBand(fire.contained);
  const key = `${band}${size}`;
  let icon = fireIcons.get(key);
  if (!icon) {
    icon = divIcon({
      className: "",
      iconSize: [size, size],
      html: `<div class="fire-point${band === "active" ? " fire-point-active" : ""}" style="background:${containmentColor(fire.contained)}"></div>`,
    });
    fireIcons.set(key, icon);
  }
  return icon;
}

/** Contained fires underneath, active ones on top; bigger over smaller within each. */
const BAND_ORDER = { contained: 0, most: 1, half: 2, active: 3 } as const;

export const FireLayer = memo(function FireLayer({
  incidents,
  onSelect,
}: {
  incidents: WildfireIncident[];
  onSelect: (fire: WildfireIncident) => void;
}) {
  const map = useMapEvents({ zoomend: () => setScale(zoomScale(map.getZoom())) });
  const [scale, setScale] = useState(() => zoomScale(map.getZoom()));
  return (
    <>
      {incidents.map((fire) => (
        <Marker
          key={fire.id}
          position={fire.coord}
          icon={fireIcon(fire, scale)}
          title={fire.name}
          zIndexOffset={BAND_ORDER[containmentBand(fire.contained)] * 1000 + fireMarkerSize(fire.acres)}
        >
          <MapPopup>
            <strong className="block">{fire.name}</strong>
            <span className="block text-muted">
              {formatAcres(fire.acres)} · {containmentText(fire.contained)}
            </span>
            {fire.location && <span className="block text-muted-dim">{fire.location}</span>}
            <PopupButton onClick={() => onSelect(fire)} />
          </MapPopup>
        </Marker>
      ))}
    </>
  );
});

/**
 * VIIRS detections, colored by age. There can be thousands, so they share one
 * popup: a click picks a hotspot and the popup opens on it.
 */
export function HotspotLayer({ hotspots, now }: { hotspots: Hotspot[]; now: number }) {
  const [picked, setPicked] = useState<Hotspot | null>(null);
  const close = useCallback(() => setPicked(null), []);
  const closeHandlers = useMemo(() => ({ remove: close }), [close]);
  return (
    <>
      <HotspotDots hotspots={hotspots} now={now} onPick={setPicked} />
      {picked && (
        <Popup
          key={`${picked.coord.join()}-${picked.time}`}
          position={picked.coord as LatLngExpression}
          pane="popupPane"
          eventHandlers={closeHandlers}
        >
          <strong className="block">Satellite hotspot</strong>
          <span className="block text-muted">
            Seen {formatDateTime(new Date(picked.time).toISOString())} by {satelliteName(picked.satellite)}
          </span>
          <span className="block text-muted-dim">
            {picked.frp !== null ? `${picked.frp.toFixed(1)} MW fire radiative power · ` : ""}
            {picked.confidence} confidence
          </span>
        </Popup>
      )}
    </>
  );
}

const HotspotDots = memo(function HotspotDots({
  hotspots,
  now,
  onPick,
}: {
  hotspots: Hotspot[];
  now: number;
  onPick: (h: Hotspot) => void;
}) {
  // Oldest first, so the newest detections draw on top.
  const ordered = useMemo(() => [...hotspots].sort((a, b) => a.time - b.time), [hotspots]);
  return (
    <>
      {ordered.map((h, i) => (
        <CircleMarker
          key={`h-${i}-${h.time}`}
          center={h.coord}
          radius={3}
          eventHandlers={{ click: () => onPick(h) }}
          pathOptions={{ stroke: false, fillColor: hotspotColor(h.time, now), fillOpacity: 0.9 }}
        />
      ))}
    </>
  );
});
