"use client";

import { memo, useMemo, useState } from "react";
import { aqiCategory, pollutantName, pollutantReadings } from "@/lib/air-quality";
import { formatDateTime } from "@/lib/format";
import { collection, point } from "@/lib/map-features";
import type { AirQualitySite } from "@/lib/types";
import { MapPopup, useOverlay, useOverlayClick, type OverlayLayer } from "./gl";
import { aqiIcon } from "./icons";

/**
 * AirNow monitors: a dot in the AQI's color with the number inside it.
 * There are a couple of thousand, so they're one layer and share one popup.
 */

const AIR_LAYERS: OverlayLayer[] = [
  {
    id: "dots",
    type: "symbol",
    layout: {
      "icon-image": ["get", "icon"],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      // The worst air draws on top.
      "symbol-sort-key": ["get", "aqi"],
    },
  },
];

export const AirQualityLayer = memo(function AirQualityLayer({ sites }: { sites: AirQualitySite[] }) {
  const features = useMemo(
    () => collection(sites.map((site, i) => point(site.coord, { i, aqi: site.aqi, icon: aqiIcon(site.aqi) }))),
    [sites],
  );
  useOverlay("air", "air", features, AIR_LAYERS);

  const [picked, setPicked] = useState<AirQualitySite | null>(null);
  useOverlayClick("air", ["dots"], (feature) => setPicked(sites[Number(feature.properties.i)] ?? null));
  if (!picked) return null;
  return (
    <MapPopup at={picked.coord} offset={12} onClose={() => setPicked(null)}>
      <AirPopup site={picked} />
    </MapPopup>
  );
});

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
