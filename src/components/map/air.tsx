"use client";

import { divIcon, type LatLngExpression } from "leaflet";
import { memo, useCallback, useMemo, useState } from "react";
import { CircleMarker, Marker, Popup, useMapEvents } from "react-leaflet";
import { aqiCategory, pollutantName, pollutantReadings } from "@/lib/air-quality";
import { formatDateTime } from "@/lib/format";
import type { AirQualitySite } from "@/lib/types";

/**
 * AirNow monitors, colored by AQI. Zoomed out they're dots; from zoom 7 in,
 * where they no longer pile up, each shows its number. There are a couple
 * of thousand, so they share one popup: a click picks a monitor and the
 * popup opens on it.
 */

const NUMBERS_FROM_ZOOM = 7;

export function AirQualityLayer({ sites }: { sites: AirQualitySite[] }) {
  const map = useMapEvents({ zoomend: () => setNumbers(map.getZoom() >= NUMBERS_FROM_ZOOM) });
  const [numbers, setNumbers] = useState(() => map.getZoom() >= NUMBERS_FROM_ZOOM);
  const [picked, setPicked] = useState<AirQualitySite | null>(null);
  const close = useCallback(() => setPicked(null), []);
  const closeHandlers = useMemo(() => ({ remove: close }), [close]);
  // Cleanest first, so the worst air draws on top.
  const ordered = useMemo(() => [...sites].sort((a, b) => a.aqi - b.aqi), [sites]);

  return (
    <>
      {numbers ? (
        <AirBadges sites={ordered} onPick={setPicked} />
      ) : (
        <AirDots sites={ordered} onPick={setPicked} />
      )}
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

const AirDots = memo(function AirDots({
  sites,
  onPick,
}: {
  sites: AirQualitySite[];
  onPick: (site: AirQualitySite) => void;
}) {
  return (
    <>
      {sites.map((site) => (
        <CircleMarker
          key={site.id}
          center={site.coord}
          radius={4.5}
          eventHandlers={{ click: () => onPick(site) }}
          pathOptions={{ color: "#000", weight: 0.75, opacity: 0.6, fillColor: aqiCategory(site.aqi).color, fillOpacity: 0.95 }}
        />
      ))}
    </>
  );
});

const badgeIcons = new Map<number, ReturnType<typeof divIcon>>();

function badgeIcon(aqi: number) {
  let icon = badgeIcons.get(aqi);
  if (!icon) {
    const { color, text } = aqiCategory(aqi);
    icon = divIcon({
      className: "",
      iconSize: [26, 18],
      html: `<div class="aqi-badge" style="background:${color};color:${text}">${aqi}</div>`,
    });
    badgeIcons.set(aqi, icon);
  }
  return icon;
}

const AirBadges = memo(function AirBadges({
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
          icon={badgeIcon(site.aqi)}
          zIndexOffset={i}
          title={`${site.name}: AQI ${site.aqi}`}
          eventHandlers={{ click: () => onPick(site) }}
        />
      ))}
    </>
  );
});
