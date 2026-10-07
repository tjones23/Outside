"use client";

import { divIcon } from "leaflet";
import { memo, useMemo } from "react";
import { Marker, Polygon, Polyline } from "react-leaflet";
import {
  coastalColor,
  coastalName,
  currentStage,
  ktToMph,
  outlookRiskColor,
  pastColor,
  stageColor,
} from "@/lib/tropical";
import type { Theme } from "@/lib/theme";
import type { TropicalData, TropicalForecastPoint, TropicalStage, TropicalStorm } from "@/lib/types";
import { MapPopup, PopupButton } from "./layers";

/**
 * NHC storms on the map, in two panes (see `StormMap`):
 *
 * - `TropicalAreas`, below the alerts: each storm's cone and the outlook's
 *   development areas — big, faint shapes that shouldn't cover warnings.
 * - `TropicalTracks`, above the labels: past track, forecast track, coastal
 *   watches and warnings, and the forecast points, NHC-style letters in
 *   colored circles.
 */

function mph(kt: number | null): string {
  return kt === null ? "—" : `${ktToMph(kt)} mph`;
}

const icons = new Map<string, ReturnType<typeof divIcon>>();

/** A forecast point: NHC's letter (D / S / H / M) in a circle colored by strength. */
function stageIcon(stage: TropicalStage, now: boolean) {
  const key = `${stage}${now ? "*" : ""}`;
  let icon = icons.get(key);
  if (!icon) {
    const size = now ? 26 : 20;
    icon = divIcon({
      className: "",
      iconSize: [size, size],
      html: `<div class="tropical-point${now ? " tropical-point-now" : ""}" style="background:${stageColor(stage)}">${stage === "X" ? "" : stage}</div>`,
    });
    icons.set(key, icon);
  }
  return icon;
}

const disturbanceIcons = new Map<string, ReturnType<typeof divIcon>>();

function disturbanceIcon(risk: string) {
  let icon = disturbanceIcons.get(risk);
  if (!icon) {
    icon = divIcon({
      className: "",
      iconSize: [22, 22],
      html: `<div class="tropical-x" style="color:${outlookRiskColor(risk)}">✕</div>`,
    });
    disturbanceIcons.set(risk, icon);
  }
  return icon;
}

export const TropicalAreas = memo(function TropicalAreas({ data, theme }: { data: TropicalData; theme: Theme }) {
  const coneColor = theme === "light" ? "#3A3A48" : "#F2F2F7";
  return (
    <>
      {data.outlook.flatMap((area, i) =>
        area.rings.map((ring, j) => (
          <Polygon
            key={`to-${i}-${j}`}
            positions={ring}
            pathOptions={{
              color: outlookRiskColor(area.risk7day),
              weight: 2,
              dashArray: "5 5",
              fillColor: outlookRiskColor(area.risk7day),
              fillOpacity: 0.12,
            }}
          >
            <MapPopup>
              <strong className="block">Area to watch for development</strong>
              <span className="block text-muted">
                {area.prob2day || "—"} chance in 2 days · {area.prob7day || "—"} in 7 days
              </span>
              <a
                href="https://www.nhc.noaa.gov/gtwo.php"
                target="_blank"
                rel="noreferrer noopener"
                className="mt-1 inline-block text-accent"
              >
                NHC tropical outlook ↗
              </a>
            </MapPopup>
          </Polygon>
        )),
      )}
      {data.storms.flatMap((storm) =>
        storm.cone.map((ring, j) => (
          <Polygon
            key={`tc-${storm.id}-${j}`}
            positions={ring}
            interactive={false}
            pathOptions={{ color: coneColor, weight: 1.5, opacity: 0.8, fillColor: coneColor, fillOpacity: 0.12 }}
          />
        )),
      )}
    </>
  );
});

export const TropicalTracks = memo(function TropicalTracks({
  data,
  theme,
  onSelect,
}: {
  data: TropicalData;
  theme: Theme;
  onSelect: (storm: TropicalStorm) => void;
}) {
  return (
    <>
      {data.disturbances.map((d, i) => (
        <Marker key={`td-${i}`} position={d.coord} icon={disturbanceIcon(d.risk7day)}>
          <MapPopup>
            <strong className="block">Disturbance</strong>
            <span className="block text-muted">
              {d.prob2day || "—"} chance of development in 2 days · {d.prob7day || "—"} in 7 days
            </span>
          </MapPopup>
        </Marker>
      ))}
      {data.storms.map((storm) => (
        <StormTrack key={storm.id} storm={storm} trackColor={theme === "light" ? "#1B1B23" : "#FFFFFF"} onSelect={onSelect} />
      ))}
    </>
  );
});

function StormTrack({
  storm,
  trackColor,
  onSelect,
}: {
  storm: TropicalStorm;
  trackColor: string;
  onSelect: (storm: TropicalStorm) => void;
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
              windKt: null,
              gustKt: null,
              stage: currentStage(storm),
              stageName: storm.title,
            },
          ],
    [storm],
  );

  return (
    <>
      {storm.past.map((seg, i) => (
        <Polyline
          key={`tp-${i}`}
          positions={seg.line}
          interactive={false}
          pathOptions={{ color: pastColor(seg.stormType), weight: 3, opacity: 0.9 }}
        />
      ))}
      {storm.coastal.map((c, i) => (
        <Polyline
          key={`tw-${i}`}
          positions={c.line}
          pathOptions={{ color: coastalColor(c.kind), weight: 7, opacity: 0.95, lineCap: "butt" }}
        >
          <MapPopup>
            <strong className="block">{coastalName(c.kind)}</strong>
            <span className="block text-muted">{storm.title}</span>
            <PopupButton onClick={() => onSelect(storm)} />
          </MapPopup>
        </Polyline>
      ))}
      {storm.track.length > 1 && (
        <Polyline
          positions={storm.track}
          interactive={false}
          pathOptions={{ color: trackColor, weight: 2, opacity: 0.85, dashArray: "6 6" }}
        />
      )}
      {points.map((p, i) => (
        <Marker key={`tf-${i}`} position={p.coord} icon={stageIcon(p.stage, i === 0)} zIndexOffset={i === 0 ? 500 : 0}>
          <MapPopup>
            <strong className="block">{i === 0 ? storm.title : `${p.stageName} · ${p.label}`}</strong>
            <span className="block text-muted">
              {i === 0
                ? [storm.windMph !== null && `${storm.windMph} mph`, storm.movement && `moving ${storm.movement}`]
                    .filter(Boolean)
                    .join(" · ")
                : `Winds ${mph(p.windKt)}${p.gustKt !== null ? `, gusts ${mph(p.gustKt)}` : ""}`}
            </span>
            {i > 0 && <span className="block text-muted-dim">{p.tau} hours out</span>}
            <PopupButton onClick={() => onSelect(storm)} />
          </MapPopup>
        </Marker>
      ))}
    </>
  );
}
