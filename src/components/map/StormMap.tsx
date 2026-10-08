"use client";

import { SVG } from "leaflet";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Pane, TileLayer, ZoomControl, useMap } from "react-leaflet";
import { alertContains, byPriority } from "@/lib/alerts";
import { forecastProduct } from "@/lib/forecast";
import { US_BOUNDS } from "@/lib/geo";
import {
  PRECIP_TYPE_ATTRIBUTION,
  PRECIP_TYPE_ATTRIBUTION_HTML,
  PRECIP_TYPE_MAX_NATIVE_ZOOM,
  precipTypeFrame,
} from "@/lib/precip-type";
import type { LatLng, RadarFrame, StormAlert, StormReport, TropicalStorm } from "@/lib/types";
import { AlertDetail, ReportDetail, TropicalDetail } from "../Details";
import { FiltersPanel } from "../FiltersPanel";
import { NearbyBanner } from "../NearbyBanner";
import { useLocation } from "../providers/LocationProvider";
import { useStormData } from "../providers/StormDataProvider";
import { useFilteredData } from "../providers/useFilteredData";
import { useTheme } from "../providers/useTheme";
import { ForecastLegend } from "./ForecastLegend";
import { AlertLayer, AlertPickPopup, DamageLayer, OutlookLayer, ReportLayer, UserLocationMarker } from "./layers";
import { OutlookLegend } from "./OutlookLegend";
import { PrecipTypeLegend } from "./PrecipTypeLegend";
import { FrameLayer, FrameTimeline, useFramePlayback } from "./radar";
import { SmoothWheelZoom } from "./SmoothWheelZoom";
import { TropicalAreas, TropicalTracks } from "./tropical";

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
  tropicalAreas: 412,
  alerts: 415,
  labels: 420,
  tropical: 423,
  reports: 430,
  you: 435,
} as const;

const NO_FRAMES: RadarFrame[] = [];

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

/**
 * The zoom buttons and keyboard move half a level rather than Leaflet's
 * default of doubling or halving the scale. Wheel and trackpad zoom is
 * continuous (see `SmoothWheelZoom`), so it replaces Leaflet's own.
 */
const ZOOM = { zoomSnap: 0.25, zoomDelta: 0.5, scrollWheelZoom: false } as const;

/**
 * Tiles stay put mid-zoom (the old ones scale until the gesture ends) and
 * a wider ring of them is kept after a pan, so less of the map goes blank
 * and reloads. (The imagery frames in `radar.tsx` do the same.)
 */
const STEADY_TILES = { updateWhenZooming: false, keepBuffer: 4 } as const;

// Each pane gets its own SVG renderer, built with Leaflet's defaults. Leaflet
// draws vectors only 10% past the viewport, so on a zoom out the edges stay
// empty until the animation ends, then pop in. Draw half a screen past.
SVG.mergeOptions({ padding: 0.5 });

export default function StormMap({ active }: { active: boolean }) {
  const { alerts, reports, damageAreas, filters } = useFilteredData();
  const {
    outlook,
    radar,
    tropical,
    forecast,
    alerts: alertFeed,
    reports: reportFeed,
  } = useStormData();
  const location = useLocation();
  const theme = useTheme();
  const canvas = ESRI_CANVAS[theme];

  const [showFilters, setShowFilters] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState<StormAlert | null>(null);
  const [selectedReport, setSelectedReport] = useState<StormReport | null>(null);
  const [selectedStorm, setSelectedStorm] = useState<TropicalStorm | null>(null);
  const [pick, setPick] = useState<{ at: LatLng; alerts: StormAlert[]; n: number } | null>(null);
  const [recenter, setRecenter] = useState<{ to: LatLng; zoom: number; n: number } | null>(null);

  // Radar and a forecast animation share one imagery slot; filters never turn both on.
  const manifest = filters.showRadar ? (radar.data?.manifest ?? null) : null;
  // Keyed by the frame times, so a poll that brings nothing new doesn't restart the loop.
  const radarKey = manifest?.frames.map((f) => f.time).join() ?? "";
  const radarFrames = useMemo(
    () => (radarKey ? radarKey.split(",").map((t) => precipTypeFrame(Number(t))) : NO_FRAMES),
    [radarKey],
  );
  const forecastData = filters.forecastProduct && forecast.data?.product === filters.forecastProduct ? forecast.data : null;
  const forecastFrames = forecastData?.frames ?? NO_FRAMES;
  const radarPlayback = useFramePlayback(radarFrames, "newest-first");
  const forecastPlayback = useFramePlayback(forecastFrames, "oldest-first");
  const outlookData = outlook.data;
  const tropicalData = filters.showTropical ? tropical.data : null;

  // Every alert under a tap, most important first — the polygons stack.
  const pickAt = useCallback(
    (at: LatLng) => {
      const here = alerts.filter((a) => alertContains(a, at)).sort(byPriority);
      if (here.length > 0) setPick((p) => ({ at, alerts: here, n: (p?.n ?? 0) + 1 }));
    },
    [alerts],
  );
  const closePick = useCallback(() => setPick(null), []);

  const flyTo = useCallback((to: LatLng, zoom: number) => setRecenter((r) => ({ to, zoom, n: (r?.n ?? 0) + 1 })), []);

  const loading = alertFeed.loading || reportFeed.loading;
  const errors = [
    alertFeed.error && "alerts",
    reportFeed.error && "reports",
    outlook.error && "outlook",
    radar.error && "radar",
    tropical.error && "tropical",
    forecast.error && "forecast",
  ].filter(Boolean);

  const locate = async () => {
    const fix = await location.request();
    if (fix) flyTo(fix, 9);
  };

  return (
    <div className="relative h-full w-full">
      <MapContainer
        bounds={US_BOUNDS}
        zoomControl={false}
        worldCopyJump
        minZoom={3}
        {...ZOOM}
        className="h-full w-full"
      >
        <TileLayer
          url={`${ESRI}/${canvas}_Base/MapServer/tile/{z}/{y}/{x}`}
          attribution={ESRI_ATTRIBUTION}
          maxNativeZoom={ESRI_MAX_NATIVE_ZOOM}
          maxZoom={19}
          zIndex={1}
          {...STEADY_TILES}
        />
        {radarFrames.length > 0 && (
          <FrameLayer
            playback={radarPlayback}
            opacity={filters.radarOpacity}
            order="newest-first"
            maxNativeZoom={PRECIP_TYPE_MAX_NATIVE_ZOOM}
            attribution={PRECIP_TYPE_ATTRIBUTION_HTML}
          />
        )}
        {forecastData && (
          <FrameLayer
            playback={forecastPlayback}
            opacity={filters.radarOpacity}
            order="oldest-first"
            maxNativeZoom={forecastProduct(forecastData.product).maxNativeZoom}
            attribution={forecastData.attribution}
          />
        )}

        <Pane name="outlook" style={{ zIndex: PANES.outlook }}>
          {outlookData && <OutlookLayer data={outlookData} theme={theme} />}
        </Pane>
        <Pane name="damage" style={{ zIndex: PANES.damage }}>
          <DamageLayer areas={damageAreas} />
        </Pane>
        <Pane name="tropicalAreas" style={{ zIndex: PANES.tropicalAreas }}>
          {tropicalData && <TropicalAreas data={tropicalData} theme={theme} />}
        </Pane>
        <Pane name="alerts" style={{ zIndex: PANES.alerts }}>
          <AlertLayer alerts={alerts} onPick={pickAt} />
        </Pane>
        <Pane name="labels" style={{ zIndex: PANES.labels, pointerEvents: "none" }}>
          <TileLayer
            url={`${ESRI}/${canvas}_Reference/MapServer/tile/{z}/{y}/{x}`}
            maxNativeZoom={ESRI_MAX_NATIVE_ZOOM}
            maxZoom={19}
            {...STEADY_TILES}
          />
        </Pane>
        <Pane name="tropical" style={{ zIndex: PANES.tropical }}>
          {tropicalData && <TropicalTracks data={tropicalData} theme={theme} onSelect={setSelectedStorm} />}
        </Pane>
        <Pane name="reports" style={{ zIndex: PANES.reports }}>
          <ReportLayer reports={reports} onSelect={setSelectedReport} />
        </Pane>

        <Pane name="you" style={{ zIndex: PANES.you }}>
          {location.coord && <UserLocationMarker at={location.coord} accuracy={location.accuracy} />}
        </Pane>
        {pick && (
          <AlertPickPopup
            key={pick.n}
            at={pick.at}
            alerts={pick.alerts}
            onSelect={setSelectedAlert}
            onClose={closePick}
          />
        )}
        <ZoomControl position="bottomright" />
        <SmoothWheelZoom />
        <FitOnShow active={active} />
        {recenter && <Recenter key={recenter.n} to={recenter.to} zoom={recenter.zoom} />}
      </MapContainer>

      {loading && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[500] h-0.5 overflow-hidden bg-accent/20">
          <div className="h-full w-1/3 animate-[loading_1.1s_ease-in-out_infinite] bg-accent" />
        </div>
      )}

      {/* Top: nearby banner; controls on the right. */}
      <div className="pointer-events-none absolute inset-x-3 top-3 z-[500] flex items-start gap-3">
        <div className="pointer-events-auto flex min-w-0 max-w-md flex-1 flex-col gap-2">
          <NearbyBanner
            onSelectAlert={(id) => setSelectedAlert(alerts.find((a) => a.id === id) ?? alertFeed.data?.alerts.find((a) => a.id === id) ?? null)}
          />
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
        {radarFrames.length > 0 && (
          <div className="pointer-events-auto flex w-full max-w-md flex-col gap-2">
            <PrecipTypeLegend />
            <FrameTimeline playback={radarPlayback} label="radar" attribution={PRECIP_TYPE_ATTRIBUTION} />
          </div>
        )}
        {filters.forecastProduct && (
          <div className="pointer-events-auto flex w-full max-w-md flex-col gap-2">
            <ForecastLegend id={filters.forecastProduct} data={forecastData} />
            {forecastData && forecastFrames.length > 0 ? (
              <FrameTimeline
                playback={forecastPlayback}
                label="forecast"
                attribution={forecastProduct(forecastData.product).source}
                withDay={forecastData.product !== "hrrr-refd"}
              />
            ) : (
              forecast.loading && (
                <p className="w-fit rounded-full border border-line bg-ink/85 px-3 py-1 text-xs text-muted backdrop-blur-md">
                  Loading forecast…
                </p>
              )
            )}
          </div>
        )}
      </div>

      {showFilters && <FiltersPanel onClose={() => setShowFilters(false)} />}
      {selectedAlert && <AlertDetail alert={selectedAlert} onClose={() => setSelectedAlert(null)} />}
      {selectedReport && <ReportDetail report={selectedReport} onClose={() => setSelectedReport(null)} />}
      {selectedStorm && (
        <TropicalDetail
          // Show the latest advisory's numbers even if the sheet was opened from an older poll.
          storm={tropicalData?.storms.find((s) => s.id === selectedStorm.id) ?? selectedStorm}
          onClose={() => setSelectedStorm(null)}
        />
      )}
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

/** Fly to a point, zooming in to at least `zoom` (never out). */
function Recenter({ to, zoom }: { to: LatLng; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(to, Math.max(map.getZoom(), zoom), { duration: 0.8 });
  }, [map, to, zoom]);
  return null;
}
