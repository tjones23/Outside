"use client";

import { useEffect, useRef, useState } from "react";
import { MapContainer, Pane, TileLayer, ZoomControl, useMap } from "react-leaflet";
import { US_BOUNDS } from "@/lib/geo";
import type { LatLng, StormAlert, StormReport } from "@/lib/types";
import { AlertDetail, ReportDetail } from "../Details";
import { CategoryChips } from "../FilterChips";
import { FiltersPanel } from "../FiltersPanel";
import { NearbyBanner } from "../NearbyBanner";
import { useLocation } from "../providers/LocationProvider";
import { useStormData } from "../providers/StormDataProvider";
import { useFilteredData } from "../providers/useFilteredData";
import { useTheme } from "../providers/useTheme";
import { AlertLayer, DamageLayer, OutlookLayer, ReportLayer, UserLocationMarker } from "./layers";
import { OutlookLegend } from "./OutlookLegend";
import { RadarLayer, RadarTimeline, useRadarPlayback } from "./radar";

/**
 * Layer order, bottom to top. Each group gets its own pane so a feed that
 * reloads can't jump above one that didn't — with one shared canvas, Leaflet
 * would redraw whatever was added last on top.
 *
 * Vectors are drawn as SVG, not canvas. A canvas renderer puts one full-map
 * canvas in each pane, and the topmost one takes every click — nothing in a
 * lower pane (warnings, outlooks) could be clicked. SVG is hit-tested per
 * shape, so each pane passes clicks through wherever it has nothing drawn.
 */
const PANES = {
  outlook: 405,
  damage: 410,
  alerts: 415,
  labels: 420,
  alertMarkers: 425,
  reports: 430,
} as const;

/**
 * Esri's Dark Gray and Light Gray Canvas, one per theme: free and keyless
 * with attribution. (CARTO's tiles, the usual choice, now answer every
 * request with an "API key required" placeholder.) Base and labels are
 * separate services, so the labels can sit above radar and warning polygons.
 */
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas";
const ESRI_CANVAS = { dark: "World_Dark_Gray", light: "World_Light_Gray" } as const;
const ESRI_ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors';
const ESRI_MAX_NATIVE_ZOOM = 16;

export default function StormMap({ active }: { active: boolean }) {
  const { alerts, reports, damageAreas, filters } = useFilteredData();
  const { outlook, radar, alerts: alertFeed, reports: reportFeed } = useStormData();
  const location = useLocation();
  const theme = useTheme();
  const canvas = ESRI_CANVAS[theme];

  const [showFilters, setShowFilters] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState<StormAlert | null>(null);
  const [selectedReport, setSelectedReport] = useState<StormReport | null>(null);
  const [recenter, setRecenter] = useState<{ to: LatLng; n: number } | null>(null);

  const manifest = filters.showRadar ? (radar.data?.manifest ?? null) : null;
  const playback = useRadarPlayback(manifest);
  const outlookData = outlook.data;

  const loading = alertFeed.loading || reportFeed.loading;
  const errors = [alertFeed.error && "warnings", reportFeed.error && "reports", outlook.error && "outlook", radar.error && "radar"].filter(Boolean);

  const locate = async () => {
    const fix = await location.request();
    if (fix) setRecenter((r) => ({ to: fix, n: (r?.n ?? 0) + 1 }));
  };

  return (
    <div className="relative h-full w-full">
      <MapContainer
        bounds={US_BOUNDS}
        zoomControl={false}
        worldCopyJump
        minZoom={3}
        className="h-full w-full"
      >
        <TileLayer
          url={`${ESRI}/${canvas}_Base/MapServer/tile/{z}/{y}/{x}`}
          attribution={ESRI_ATTRIBUTION}
          maxNativeZoom={ESRI_MAX_NATIVE_ZOOM}
          maxZoom={19}
          zIndex={1}
        />
        <RadarLayer playback={playback} opacity={filters.radarOpacity} />

        <Pane name="outlook" style={{ zIndex: PANES.outlook }}>
          {outlookData && <OutlookLayer data={outlookData} theme={theme} />}
        </Pane>
        <Pane name="damage" style={{ zIndex: PANES.damage }}>
          <DamageLayer areas={damageAreas} />
        </Pane>
        <Pane name="alerts" style={{ zIndex: PANES.alerts }}>
          <AlertLayer alerts={alerts} onSelect={setSelectedAlert} markers={false} />
        </Pane>
        <Pane name="labels" style={{ zIndex: PANES.labels, pointerEvents: "none" }}>
          <TileLayer
            url={`${ESRI}/${canvas}_Reference/MapServer/tile/{z}/{y}/{x}`}
            maxNativeZoom={ESRI_MAX_NATIVE_ZOOM}
            maxZoom={19}
          />
        </Pane>
        <Pane name="alertMarkers" style={{ zIndex: PANES.alertMarkers }}>
          <AlertLayer alerts={alerts} onSelect={setSelectedAlert} markers />
        </Pane>
        <Pane name="reports" style={{ zIndex: PANES.reports }}>
          <ReportLayer reports={reports} onSelect={setSelectedReport} />
        </Pane>

        {location.coord && <UserLocationMarker at={location.coord} />}
        <ZoomControl position="bottomright" />
        <FitOnShow active={active} />
        {recenter && <Recenter key={recenter.n} to={recenter.to} />}
      </MapContainer>

      {loading && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[500] h-0.5 overflow-hidden bg-accent/20">
          <div className="h-full w-1/3 animate-[loading_1.1s_ease-in-out_infinite] bg-accent" />
        </div>
      )}

      {/* Top: nearby banner and category chips; controls on the right. */}
      <div className="pointer-events-none absolute inset-x-3 top-3 z-[500] flex items-start gap-3">
        <div className="pointer-events-auto flex min-w-0 max-w-md flex-1 flex-col gap-2">
          <NearbyBanner
            onSelectAlert={(id) => setSelectedAlert(alerts.find((a) => a.id === id) ?? alertFeed.data?.alerts.find((a) => a.id === id) ?? null)}
          />
          <div className="rounded-full">
            <CategoryChips />
          </div>
          {errors.length > 0 && (
            <p className="w-fit rounded-full border border-danger/40 bg-ink/85 px-3 py-1 text-xs text-text backdrop-blur-md">
              Couldn&apos;t refresh {errors.join(", ")} — retrying.
            </p>
          )}
        </div>
        <div className="pointer-events-auto ml-auto flex flex-col gap-2">
          <MapButton label="Filters" onClick={() => setShowFilters(true)}>
            <path d="M4 6h16M7 12h10M10 18h4" strokeLinecap="round" />
          </MapButton>
          <MapButton
            label={location.available ? "My location" : "My location needs the HTTPS address"}
            onClick={() => void locate()}
            disabled={!location.available || location.busy}
          >
            <circle cx="12" cy="12" r="3.5" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" strokeLinecap="round" />
          </MapButton>
        </div>
      </div>

      {/* Bottom: legend and radar timeline. */}
      <div className="pointer-events-none absolute inset-x-3 bottom-3 z-[500] flex flex-col items-start gap-2 pr-12">
        {outlookData && outlookData.features.length > 0 && (
          <div className="pointer-events-auto">
            <OutlookLegend data={outlookData} theme={theme} />
          </div>
        )}
        {manifest && playback.frames.length > 0 && (
          <div className="pointer-events-auto w-full max-w-md">
            <RadarTimeline playback={playback} attribution={manifest.attribution} />
          </div>
        )}
      </div>

      {showFilters && <FiltersPanel onClose={() => setShowFilters(false)} />}
      {selectedAlert && <AlertDetail alert={selectedAlert} onClose={() => setSelectedAlert(null)} />}
      {selectedReport && <ReportDetail report={selectedReport} onClose={() => setSelectedReport(null)} />}
    </div>
  );
}

function MapButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-ink/85 text-text shadow-lg backdrop-blur-md transition-colors hover:border-muted-dim disabled:opacity-40"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        {children}
      </svg>
    </button>
  );
}

/**
 * The map sits in a container that may be hidden when it mounts (the first
 * page opened wasn't the map), so Leaflet can settle on a zero size. Re-measure
 * whenever it's shown, and frame the continental US the first time it has
 * real dimensions.
 */
function FitOnShow({ active }: { active: boolean }) {
  const map = useMap();
  const framed = useRef(false);
  useEffect(() => {
    if (!active) return;
    const id = window.setTimeout(() => {
      map.invalidateSize();
      if (!framed.current && map.getContainer().clientHeight > 0) {
        map.fitBounds(US_BOUNDS);
        framed.current = true;
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [active, map]);
  return null;
}

function Recenter({ to }: { to: LatLng }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(to, Math.max(map.getZoom(), 9), { duration: 0.8 });
  }, [map, to]);
  return null;
}
