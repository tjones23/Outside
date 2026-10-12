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
 * - `FireLayer`, above that: a flame where each fire started, sized by acres.
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

/**
 * A flame in the shape of 🔥 — an emoji can't be recolored, so it's drawn:
 * the outer flame takes the containment color, the inner one a lighter tint
 * of it. Drawn on a 24-unit square, its base at the bottom center.
 */
const FLAME_OUTER =
  "M12 1.5C12.6 5 15.5 6.8 17.3 9.6C18.6 11.6 19.2 13.4 19.2 15.2C19.2 19.4 16 22.5 12 22.5C8 22.5 4.8 19.4 4.8 15.4C4.8 12.9 6 10.9 7.4 9.4C7.5 11 8.2 12.3 9.3 13C9 9.2 10.4 5.2 12 1.5Z";
const FLAME_INNER =
  "M12 12.2C12.4 14.2 14.6 15.4 14.6 17.8C14.6 19.4 13.4 20.6 12 20.6C10.6 20.6 9.4 19.4 9.4 17.9C9.4 16.2 10.6 15.1 11.2 13.6C11.5 13.1 11.8 12.6 12 12.2Z";
const FLAME_STROKE = "rgb(0 0 0 / 0.7)";

function flameSvg(color: string, className: string): string {
  return (
    `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">` +
    `<path d="${FLAME_OUTER}" fill="${color}" stroke="${FLAME_STROKE}" stroke-width="1.4" stroke-linejoin="round"/>` +
    `<path d="${FLAME_INNER}" fill="#fff" fill-opacity="0.55"/>` +
    "</svg>"
  );
}

/** The same flame for legends and lists. */
export function Flame({ color, className }: { color: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path d={FLAME_OUTER} fill={color} stroke={FLAME_STROKE} strokeWidth={1.4} strokeLinejoin="round" />
      <path d={FLAME_INNER} fill="#fff" fillOpacity={0.55} />
    </svg>
  );
}

const fireIcons = new Map<string, ReturnType<typeof divIcon>>();

/**
 * Zoomed out to the whole country, a few hundred fires would bury the West;
 * flames shrink below zoom 6.
 */
function zoomScale(zoom: number): number {
  return zoom >= 6 ? 1 : zoom >= 5 ? 0.8 : 0.6;
}

/** A flame needs more room than a dot to read as one. */
const FLAME_SCALE = 1.5;

/** A flame colored by containment, sized by acres and zoom; active fires glow. */
function fireIcon(fire: WildfireIncident, scale: number) {
  const size = Math.max(9, Math.round(fireMarkerSize(fire.acres) * FLAME_SCALE * scale));
  const band = containmentBand(fire.contained);
  const key = `${band}${size}`;
  let icon = fireIcons.get(key);
  if (!icon) {
    icon = divIcon({
      className: "",
      iconSize: [size, size],
      // The flame stands on the point where the fire started.
      iconAnchor: [size / 2, Math.round(size * 0.94)],
      popupAnchor: [0, -Math.round(size * 0.8)],
      html: flameSvg(containmentColor(fire.contained), band === "active" ? "fire-flame fire-flame-active" : "fire-flame"),
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
