"use client";

import { memo, useMemo, useState } from "react";
import { alertLevelName } from "@/lib/alert-catalog";
import { categoryColor, categoryGlyph } from "@/lib/categories";
import { formatDateTime } from "@/lib/format";
import { circleRing, collection, line, point, polygon } from "@/lib/map-features";
import { fillLayer, lineLayer } from "@/lib/map-style";
import { featureColors } from "@/lib/outlook";
import type { Theme } from "@/lib/theme";
import type { AlertLevel, DamageArea, LatLng, OutlookData, StormAlert, StormReport } from "@/lib/types";
import { HtmlMarker, MapPopup, PopupButton, useOverlay, useOverlayClick, type OverlayLayer } from "./gl";

/**
 * The map's vector layers. Each is memoized on its data so the radar
 * animation (which re-renders the map twice a second) never rebuilds them.
 */

const OUTLOOK_LAYERS: OverlayLayer[] = [
  { ...fillLayer, filter: ["==", ["geometry-type"], "Polygon"] },
  { ...lineLayer({ hatched: [3, 2] }), filter: ["==", ["geometry-type"], "Polygon"] },
  { ...lineLayer({}, "hatch"), filter: ["==", ["geometry-type"], "LineString"] },
];

export const OutlookLayer = memo(function OutlookLayer({ data, theme }: { data: OutlookData; theme: Theme }) {
  const features = useMemo(
    () =>
      collection([
        ...data.features.flatMap((f, i) => {
          const { fill, stroke } = featureColors(f, theme);
          const props = {
            i,
            stroke,
            so: 0.9,
            w: f.isHatched ? ((f.cigLevel ?? 1) >= 2 ? 3 : 2) : 1.5,
            fill: f.isHatched ? stroke : fill,
            // General thunder is a wash across half the country; keep it faint.
            fo: f.isHatched ? 0.06 : f.isGeneralThunderstorm ? 0.1 : 0.3,
            dash: f.isHatched ? "hatched" : "",
          };
          return f.rings.map((ring) => polygon([ring], props));
        }),
        ...data.features.flatMap((f) => {
          const stroke = featureColors(f, theme).stroke;
          return f.hatch.map((slash) => line(slash, { stroke, so: 0.75, w: 1 }));
        }),
      ]),
    [data, theme],
  );
  useOverlay("outlook", "outlook", features, OUTLOOK_LAYERS);

  const [picked, setPicked] = useState<{ at: LatLng; i: number } | null>(null);
  useOverlayClick("outlook", ["fill"], (feature, at) => setPicked({ at, i: Number(feature.properties.i) }));
  const f = picked && data.features[picked.i];
  if (!picked || !f) return null;
  return (
    <MapPopup at={picked.at} onClose={() => setPicked(null)}>
      <strong className="block">{f.detail || f.label}</strong>
      <span className="block text-muted">
        {data.product.center} {data.product.title}
      </span>
      <a href={data.product.discussionUrl} target="_blank" rel="noreferrer noopener" className="mt-1 inline-block text-accent">
        {data.product.center} discussion ↗
      </a>
    </MapPopup>
  );
});

const SHAPE_LAYERS: OverlayLayer[] = [fillLayer, lineLayer()];

/** Fill opacity scales with the worst report in the cluster. */
export const DamageLayer = memo(function DamageLayer({ areas }: { areas: DamageArea[] }) {
  const features = useMemo(
    () =>
      collection(
        areas.map((area) => {
          const color = categoryColor(area.category);
          return polygon([area.ring], {
            stroke: color,
            so: 0.85,
            w: 1.5,
            fill: color,
            fo: 0.2 + area.severity * (0.68 - 0.2),
          });
        }),
      ),
    [areas],
  );
  useOverlay("damage", "damage", features, SHAPE_LAYERS);
  return null;
});

/** How each tier is drawn: warnings solid and bold, watches dashed, the rest lighter. */
const LEVEL_STYLE: Record<AlertLevel, { w: number; fo: number; dash: string }> = {
  warning: { w: 2.5, fo: 0.22, dash: "" },
  watch: { w: 1.5, fo: 0.08, dash: "watch" },
  advisory: { w: 1.5, fo: 0.16, dash: "" },
  statement: { w: 1, fo: 0.08, dash: "statement" },
};

// Watches 6 px on, 5 off at 1.5 px; statements 2 on, 4 off at 1 px — in line widths.
const ALERT_LAYERS: OverlayLayer[] = [fillLayer, lineLayer({ watch: [4, 3.3], statement: [2, 4] })];

/**
 * Warning, watch and advisory polygons.
 *
 * Zone-based alerts stack — a Heat Advisory, a Flood Watch and a Coastal
 * Flood Warning can all cover one town — so a tap doesn't open the topmost
 * polygon's popup; it reports where it landed (`onPick`), and the map lists
 * every alert there.
 */
export const AlertLayer = memo(function AlertLayer({
  alerts,
  onPick,
}: {
  alerts: StormAlert[];
  onPick: (at: LatLng) => void;
}) {
  const features = useMemo(
    () =>
      collection(
        // Least important first, so the most important draws on top.
        [...alerts]
          .sort((a, b) => b.priority - a.priority)
          .flatMap((a) => {
            const style = LEVEL_STYLE[a.level];
            const props = { stroke: a.color, fill: a.color, ...style };
            return a.polygons.map((ring) => polygon([ring], props));
          }),
      ),
    [alerts],
  );
  useOverlay("alerts", "alerts", features, ALERT_LAYERS);
  useOverlayClick("alerts", ["fill"], (_, at) => onPick(at));
  return null;
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
  return (
    <MapPopup at={at} onClose={onClose}>
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
    </MapPopup>
  );
}

const REPORT_LAYERS: OverlayLayer[] = [
  {
    id: "dots",
    type: "circle",
    paint: {
      "circle-radius": 4.5,
      "circle-color": ["get", "color"],
      "circle-stroke-color": "#000",
      "circle-stroke-width": 1,
    },
  },
];

export const ReportLayer = memo(function ReportLayer({
  reports,
  onSelect,
}: {
  reports: StormReport[];
  onSelect: (r: StormReport) => void;
}) {
  const features = useMemo(
    () => collection(reports.map((r, i) => point(r.coord, { i, color: categoryColor(r.category) }))),
    [reports],
  );
  useOverlay("reports", "reports", features, REPORT_LAYERS);

  const [picked, setPicked] = useState<StormReport | null>(null);
  useOverlayClick("reports", ["dots"], (feature) => setPicked(reports[Number(feature.properties.i)] ?? null));
  if (!picked) return null;
  return (
    <MapPopup at={picked.coord} onClose={() => setPicked(null)}>
      <strong className="block">
        {categoryGlyph(picked.category)} {picked.title}
      </strong>
      <span className="block text-muted">{picked.subtitle}</span>
      <PopupButton onClick={() => onSelect(picked)} />
    </MapPopup>
  );
});

/** Past this, the halo would wash over a whole region and hide the storms under it. */
const MAX_ACCURACY_HALO_M = 25_000;

/**
 * The viewer's position: a pulsing dot, with a faint halo showing how far off
 * the fix might be. Neither takes clicks, so whatever is underneath still can.
 */
export function UserLocationMarker({ at, accuracy }: { at: LatLng; accuracy: number | null }) {
  const halo = useMemo(
    () =>
      accuracy !== null && accuracy > 0 && accuracy <= MAX_ACCURACY_HALO_M
        ? collection([
            polygon([circleRing(at, accuracy)], { stroke: "#3b82f6", so: 0.5, w: 1, fill: "#3b82f6", fo: 0.12 }),
          ])
        : null,
    [at, accuracy],
  );
  useOverlay("you", "you", halo, SHAPE_LAYERS);
  return <HtmlMarker at={at} className="you-are-here" zIndex={1000} />;
}
