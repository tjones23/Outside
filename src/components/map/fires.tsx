"use client";

import type { ExpressionSpecification } from "maplibre-gl";
import { memo, useMemo, useState } from "react";
import { formatDateTime } from "@/lib/format";
import { collection, point, polygon } from "@/lib/map-features";
import { fillLayer, lineLayer } from "@/lib/map-style";
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
import { MapPopup, PopupButton, useOverlay, useOverlayClick, type OverlayLayer } from "./gl";
import { FLAME_BOX, FLAME_INNER, FLAME_OFFSET, FLAME_OUTER, FLAME_STROKE, flameIcon } from "./icons";

/**
 * Wildfire layers, each in its own slot (see `map-style.ts`):
 *
 * - `SmokeLayer`, low down: HMS plumes, faint and not clickable — they span
 *   states, and the warnings above them need the clicks.
 * - `PerimeterLayer`, just above the warnings: each fire's mapped outline,
 *   colored by its containment.
 * - `HotspotLayer`, above the labels: the last day's VIIRS detections.
 * - `FireLayer`, above that: a flame where each fire started, sized by acres.
 */

const SHAPE_LAYERS: OverlayLayer[] = [fillLayer, lineLayer()];

export const SmokeLayer = memo(function SmokeLayer({ plumes }: { plumes: SmokePlume[] }) {
  const features = useMemo(
    () =>
      collection(
        plumes.flatMap((plume) => {
          const style = smokeStyle(plume.density);
          const props = { stroke: style.color, so: 0.5, w: 1, fill: style.color, fo: style.fillOpacity };
          return plume.rings.map((ring) => polygon([ring], props));
        }),
      ),
    [plumes],
  );
  useOverlay("smoke", "smoke", features, SHAPE_LAYERS);
  return null;
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
  const features = useMemo(
    () =>
      collection(
        perimeters.flatMap((p, i) => {
          const color = containmentColor(byId.get(p.id)?.contained ?? null);
          const props = { i, stroke: color, so: 0.95, w: 1.5, fill: color, fo: 0.25 };
          return p.rings.map((ring) => polygon([ring], props));
        }),
      ),
    [perimeters, byId],
  );
  useOverlay("perimeters", "perimeters", features, SHAPE_LAYERS);

  const [picked, setPicked] = useState<{ at: [number, number]; perimeter: WildfirePerimeter } | null>(null);
  useOverlayClick("perimeters", ["fill"], (feature, at) => {
    const perimeter = perimeters[Number(feature.properties.i)];
    if (perimeter) setPicked({ at, perimeter });
  });
  if (!picked) return null;
  const p = picked.perimeter;
  const fire = byId.get(p.id);
  return (
    <MapPopup at={picked.at} onClose={() => setPicked(null)}>
      <strong className="block">{fire?.name ?? p.name}</strong>
      <span className="block text-muted">
        {[formatAcres(p.acres ?? fire?.acres ?? null), fire && containmentText(fire.contained)].filter(Boolean).join(" · ")}
      </span>
      <span className="block text-muted-dim">Perimeter mapped {formatDateTime(p.mapped)}</span>
      {fire && <PopupButton onClick={() => onSelect(fire)} />}
    </MapPopup>
  );
});

/** The same flame for legends and lists. */
export function Flame({ color, className }: { color: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path d={FLAME_OUTER} fill={color} stroke={FLAME_STROKE} strokeWidth={1.4} strokeLinejoin="round" />
      <path d={FLAME_INNER} fill="#fff" fillOpacity={0.55} />
    </svg>
  );
}

/** A flame needs more room than a dot to read as one. */
const FLAME_SCALE = 1.5;
/** The smallest flame, in pixels. */
const MIN_FLAME = 9;

/** Contained fires underneath, active ones on top; bigger over smaller within each. */
const BAND_ORDER = { contained: 0, most: 1, half: 2, active: 3 } as const;

/**
 * Zoomed out to the whole country, a few hundred fires would bury the West;
 * flames shrink below zoom 5.
 */
const flameSize = (scale: number): ExpressionSpecification => [
  "/",
  ["max", MIN_FLAME, ["*", scale, ["get", "size"]]],
  FLAME_BOX,
];

const FIRE_LAYERS: OverlayLayer[] = [
  {
    id: "flames",
    type: "symbol",
    layout: {
      "icon-image": ["get", "icon"],
      "icon-size": ["step", ["zoom"], flameSize(0.6), 4, flameSize(0.8), 5, flameSize(1)],
      "icon-offset": FLAME_OFFSET,
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "symbol-sort-key": ["get", "order"],
    },
  },
];

/** A flame colored by containment, sized by acres and zoom; active fires glow. */
export const FireLayer = memo(function FireLayer({
  incidents,
  onSelect,
}: {
  incidents: WildfireIncident[];
  onSelect: (fire: WildfireIncident) => void;
}) {
  const features = useMemo(
    () =>
      collection(
        incidents.map((fire, i) => {
          const band = containmentBand(fire.contained);
          const size = fireMarkerSize(fire.acres);
          return point(fire.coord, { i, icon: flameIcon(band), size: size * FLAME_SCALE, order: BAND_ORDER[band] * 1000 + size });
        }),
      ),
    [incidents],
  );
  useOverlay("fires", "fires", features, FIRE_LAYERS);

  const [picked, setPicked] = useState<WildfireIncident | null>(null);
  useOverlayClick("fires", ["flames"], (feature) => setPicked(incidents[Number(feature.properties.i)] ?? null));
  if (!picked) return null;
  return (
    <MapPopup at={picked.coord} offset={16} onClose={() => setPicked(null)}>
      <strong className="block">{picked.name}</strong>
      <span className="block text-muted">
        {formatAcres(picked.acres)} · {containmentText(picked.contained)}
      </span>
      {picked.location && <span className="block text-muted-dim">{picked.location}</span>}
      <PopupButton onClick={() => onSelect(picked)} />
    </MapPopup>
  );
});

const HOTSPOT_LAYERS: OverlayLayer[] = [
  {
    id: "dots",
    type: "circle",
    paint: { "circle-radius": 3, "circle-color": ["get", "color"], "circle-opacity": 0.9 },
  },
];

/** VIIRS detections, colored by age. There can be thousands; they're one layer and share one popup. */
export const HotspotLayer = memo(function HotspotLayer({ hotspots, now }: { hotspots: Hotspot[]; now: number }) {
  // Oldest first, so the newest detections draw on top.
  const ordered = useMemo(() => [...hotspots].sort((a, b) => a.time - b.time), [hotspots]);
  const features = useMemo(
    () => collection(ordered.map((h, i) => point(h.coord, { i, color: hotspotColor(h.time, now) }))),
    [ordered, now],
  );
  useOverlay("hotspots", "hotspots", features, HOTSPOT_LAYERS);

  const [picked, setPicked] = useState<Hotspot | null>(null);
  useOverlayClick("hotspots", ["dots"], (feature) => setPicked(ordered[Number(feature.properties.i)] ?? null));
  if (!picked) return null;
  return (
    <MapPopup at={picked.coord} onClose={() => setPicked(null)}>
      <strong className="block">Satellite hotspot</strong>
      <span className="block text-muted">
        Seen {formatDateTime(new Date(picked.time).toISOString())} by {satelliteName(picked.satellite)}
      </span>
      <span className="block text-muted-dim">
        {picked.frp !== null ? `${picked.frp.toFixed(1)} MW fire radiative power · ` : ""}
        {picked.confidence} confidence
      </span>
    </MapPopup>
  );
});
