"use client";

import { divIcon, type LatLngExpression } from "leaflet";
import { memo, useCallback, useMemo, useState } from "react";
import { Marker, Popup } from "react-leaflet";
import { aqiCategory, pollutantName, pollutantReadings } from "@/lib/air-quality";
import { formatDateTime } from "@/lib/format";
import type { AirQualitySite } from "@/lib/types";

/**
 * AirNow monitors: a dot in the AQI's color with the number inside it.
 * There are a couple of thousand, so they share one popup: a click picks a
 * monitor and the popup opens on it.
 */

export function AirQualityLayer({ sites }: { sites: AirQualitySite[] }) {
  const [picked, setPicked] = useState<AirQualitySite | null>(null);
  const close = useCallback(() => setPicked(null), []);
  const closeHandlers = useMemo(() => ({ remove: close }), [close]);
  // Cleanest first, so the worst air draws on top.
  const ordered = useMemo(() => [...sites].sort((a, b) => a.aqi - b.aqi), [sites]);

  return (
    <>
      <AirDots sites={ordered} onPick={setPicked} />
      {picked && (
        <Popup key={picked.id} position={picked.coord as LatLngExpression} pane="popupPane" eventHandlers={closeHandlers}>
          <AirPopup site={picked} />
        </Popup>
      )}
    </>
  );
}

function AirPopup({ site }: { site: AirQualitySite }) {
  const category = aqiCategory(site.aqi);
  return (
    <>
      <strong className="block">{site.name}</strong>
      <span className="mt-1 flex items-center gap-2">
        <span
          className="rounded px-1.5 py-0.5 text-xs font-bold tabular-nums"
          style={{ background: category.color, color: category.text }}
        >
          AQI {site.aqi}
        </span>
        <span className="text-muted">{category.label}</span>
      </span>
      <span className="mt-1 block text-muted">
        {pollutantReadings(site)
          .map(
            (r) =>
              `${pollutantName(r.pollutant)} ${r.aqi}` +
              (r.pollutant === "pm25" && site.pm25 !== null ? ` (${site.pm25} µg/m³)` : ""),
          )
          .join(" · ")}
      </span>
      <span className="block text-muted-dim">
        {formatDateTime(site.observed)}
        {site.agency && ` · ${site.agency}`}
      </span>
    </>
  );
}

const dotIcons = new Map<number, ReturnType<typeof divIcon>>();

function dotIcon(aqi: number) {
  let icon = dotIcons.get(aqi);
  if (!icon) {
    const { color, text } = aqiCategory(aqi);
    icon = divIcon({
      className: "",
      iconSize: [22, 22],
      html: `<div class="aqi-dot" style="background:${color};color:${text}">${aqi}</div>`,
    });
    dotIcons.set(aqi, icon);
  }
  return icon;
}

const AirDots = memo(function AirDots({
  sites,
  onPick,
}: {
  sites: AirQualitySite[];
  onPick: (site: AirQualitySite) => void;
}) {
  return (
    <>
      {sites.map((site, i) => (
        <Marker
          key={site.id}
          position={site.coord}
          icon={dotIcon(site.aqi)}
          zIndexOffset={i}
          title={`${site.name}: AQI ${site.aqi}`}
          eventHandlers={{ click: () => onPick(site) }}
        />
      ))}
    </>
  );
});
