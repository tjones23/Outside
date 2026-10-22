"use client";

import { memo, useMemo, useState, type ReactNode } from "react";
import { collection, line, polygon } from "@/lib/map-features";
import { fillLayer, lineLayer } from "@/lib/map-style";
import {
  coastalColor,
  coastalName,
  currentStage,
  ktToMph,
  outlookRiskColor,
  pastColor,
  stageColor,
  stageLabel,
} from "@/lib/tropical";
import type { Theme } from "@/lib/theme";
import type { LatLng, TropicalData, TropicalForecastPoint, TropicalStorm } from "@/lib/types";
import { HtmlMarker, MapPopup, PopupButton, useOverlay, useOverlayClick, type OverlayLayer } from "./gl";

/**
 * NHC storms on the map, in two slots (see `map-style.ts`):
 *
 * - `TropicalAreas`, below the alerts: each storm's cone and the outlook's
 *   development areas — big, faint shapes that shouldn't cover warnings.
 * - `TropicalTracks`, above the labels: past track, forecast track, coastal
 *   watches and warnings, the forecast points (TD / TS / H1–H5 in colored
 *   circles), and a name tag beside each storm that opens its details.
 */

function mph(kt: number | null): string {
  return kt === null ? "—" : `${ktToMph(kt)} mph`;
}

/** 5 px on, 5 off at 2 px, in line widths. */
const AREA_LAYERS: OverlayLayer[] = [fillLayer, lineLayer({ area: [2.5, 2.5] })];
const CONE_LAYERS: OverlayLayer[] = [fillLayer, lineLayer()];

export const TropicalAreas = memo(function TropicalAreas({ data, theme }: { data: TropicalData; theme: Theme }) {
  const areas = useMemo(
    () =>
      collection(
        data.outlook.flatMap((area, i) => {
          const color = outlookRiskColor(area.risk7day);
          return area.rings.map((ring) => polygon([ring], { i, stroke: color, w: 2, dash: "area", fill: color, fo: 0.12 }));
        }),
      ),
    [data],
  );
  const cones = useMemo(() => {
    const color = theme === "light" ? "#3A3A48" : "#F2F2F7";
    const props = { stroke: color, so: 0.8, w: 1.5, fill: color, fo: 0.12 };
    return collection(data.storms.flatMap((storm) => storm.cone.map((ring) => polygon([ring], props))));
  }, [data, theme]);
  useOverlay("cones", "tropicalAreas", cones, CONE_LAYERS);
  useOverlay("tropicalOutlook", "tropicalAreas", areas, AREA_LAYERS);

  const [picked, setPicked] = useState<{ at: LatLng; i: number } | null>(null);
  useOverlayClick("tropicalOutlook", ["fill"], (feature, at) => setPicked({ at, i: Number(feature.properties.i) }));
  const area = picked && data.outlook[picked.i];
  if (!picked || !area) return null;
  return (
    <MapPopup at={picked.at} onClose={() => setPicked(null)}>
      <strong className="block">Area to watch for development</strong>
      <span className="block text-muted">
        {area.prob2day || "—"} chance in 2 days · {area.prob7day || "—"} in 7 days
      </span>
      <a href="https://www.nhc.noaa.gov/gtwo.php" target="_blank" rel="noreferrer noopener" className="mt-1 inline-block text-accent">
        NHC tropical outlook ↗
      </a>
    </MapPopup>
  );
});

/** 6 px on, 6 off at 2 px, in line widths. */
const TRACK_LAYERS: OverlayLayer[] = [
  { ...lineLayer({ track: [3, 3] }), filter: ["!=", ["get", "kind"], "coastal"] },
  { ...lineLayer({}, "coastal"), filter: ["==", ["get", "kind"], "coastal"] },
];

type Picked = { at: LatLng; content: ReactNode };

export const TropicalTracks = memo(function TropicalTracks({
  data,
  theme,
  onSelect,
}: {
  data: TropicalData;
  theme: Theme;
  onSelect: (storm: TropicalStorm) => void;
}) {
  const lines = useMemo(() => {
    const trackColor = theme === "light" ? "#1B1B23" : "#FFFFFF";
    return collection(
      data.storms.flatMap((storm, s) => [
        ...storm.past.map((seg) => line(seg.line, { kind: "past", stroke: pastColor(seg.stormType), so: 0.9, w: 3 })),
        ...storm.coastal.map((c, i) =>
          line(c.line, { kind: "coastal", s, i, stroke: coastalColor(c.kind), so: 0.95, w: 7 }),
        ),
        ...(storm.track.length > 1
          ? [line(storm.track, { kind: "track", stroke: trackColor, so: 0.85, w: 2, dash: "track" })]
          : []),
      ]),
    );
  }, [data, theme]);
  useOverlay("tracks", "tropical", lines, TRACK_LAYERS);

  const [picked, setPicked] = useState<Picked | null>(null);
  useOverlayClick("tracks", ["coastal"], (feature, at) => {
    const storm = data.storms[Number(feature.properties.s)];
    const alert = storm?.coastal[Number(feature.properties.i)];
    if (!storm || !alert) return;
    setPicked({
      at,
      content: (
        <>
          <strong className="block">{coastalName(alert.kind)}</strong>
          <span className="block text-muted">{storm.title}</span>
          <PopupButton onClick={() => onSelect(storm)} />
        </>
      ),
    });
  });

  return (
    <>
      {data.disturbances.map((d, i) => (
        <HtmlMarker
          key={`td-${i}`}
          at={d.coord}
          title="Disturbance"
          onClick={() =>
            setPicked({
              at: d.coord,
              content: (
                <>
                  <strong className="block">Disturbance</strong>
                  <span className="block text-muted">
                    {d.prob2day || "—"} chance of development in 2 days · {d.prob7day || "—"} in 7 days
                  </span>
                </>
              ),
            })
          }
        >
          <div className="tropical-x h-[22px] w-[22px]" style={{ color: outlookRiskColor(d.risk7day) }}>
            ✕
          </div>
        </HtmlMarker>
      ))}
      {data.storms.map((storm) => (
        <StormPoints key={storm.id} storm={storm} onSelect={onSelect} onPick={setPicked} />
      ))}
      {picked && (
        <MapPopup at={picked.at} offset={14} onClose={() => setPicked(null)}>
          {picked.content}
        </MapPopup>
      )}
    </>
  );
});

/** A storm's forecast points (TD / TS / H1–H5 in circles colored by strength) and its name tag. */
function StormPoints({
  storm,
  onSelect,
  onPick,
}: {
  storm: TropicalStorm;
  onSelect: (storm: TropicalStorm) => void;
  onPick: (picked: Picked) => void;
}) {
  const points: TropicalForecastPoint[] = useMemo(
    () =>
      storm.forecast.length > 0
        ? storm.forecast
        : [
            {
              coord: storm.position,
              tau: 0,
              label: "Now",
              windKt: storm.windKt ?? null,
              gustKt: null,
              stage: currentStage(storm),
              stageName: storm.title,
            },
          ],
    [storm],
  );

  return (
    <>
      {points.map((p, i) => {
        const now = i === 0;
        const size = now ? 28 : 22;
        return (
          <HtmlMarker
            key={`tf-${i}`}
            at={p.coord}
            zIndex={now ? 500 : 0}
            title={now ? storm.title : `${p.stageName} · ${p.label}`}
            onClick={() =>
              onPick({
                at: p.coord,
                content: (
                  <>
                    <strong className="block">{now ? storm.title : `${p.stageName} · ${p.label}`}</strong>
                    <span className="block text-muted">
                      {now
                        ? [storm.windMph !== null && `${storm.windMph} mph`, storm.movement && `moving ${storm.movement}`]
                            .filter(Boolean)
                            .join(" · ")
                        : `Winds ${mph(p.windKt)}${p.gustKt !== null ? `, gusts ${mph(p.gustKt)}` : ""}`}
                    </span>
                    {!now && <span className="block text-muted-dim">{p.tau} hours out</span>}
                    <PopupButton onClick={() => onSelect(storm)} />
                  </>
                ),
              })
            }
          >
            <div
              className={`tropical-point${now ? " tropical-point-now" : ""}`}
              style={{ background: stageColor(p.stage), width: size, height: size }}
            >
              {stageLabel(p.stage, p.windKt)}
            </div>
          </HtmlMarker>
        );
      })}
      {/* The name tag: a zero-size anchor at the storm, the tag hanging off to the right of its circle. */}
      <HtmlMarker at={points[0].coord} zIndex={600} title={`${storm.title}: details`} onClick={() => onSelect(storm)}>
        <div className="tropical-label">
          <span className="tropical-label-dot" style={{ background: stageColor(currentStage(storm)) }} />
          {storm.name}
          {storm.windMph !== null && <span className="tropical-label-wind">{storm.windMph} mph</span>}
        </div>
      </HtmlMarker>
    </>
  );
}
