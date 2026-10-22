"use client";

import { AttributionControl, getVersion, Map as GLMap, NavigationControl, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { alertContains, byPriority } from "@/lib/alerts";
import { forecastProduct } from "@/lib/forecast";
import { US_BOUNDS } from "@/lib/geo";
import { buildStyle, keepOverlays, type StyleOptions } from "@/lib/map-style";
import {
  PRECIP_TYPE_ATTRIBUTION,
  PRECIP_TYPE_ATTRIBUTION_HTML,
  PRECIP_TYPE_MAX_NATIVE_ZOOM,
  precipTypeFrame,
} from "@/lib/precip-type";
import type { LatLng, RadarFrame, StormAlert, StormReport, TropicalStorm, WildfireIncident } from "@/lib/types";
import { AlertDetail, FireDetail, ReportDetail, TropicalDetail } from "../Details";
import { FiltersPanel } from "../FiltersPanel";
import { NearbyBanner } from "../NearbyBanner";
import { useLocation } from "../providers/LocationProvider";
import { useStormData } from "../providers/StormDataProvider";
import { useFilteredData } from "../providers/useFilteredData";
import { useTheme } from "../providers/useTheme";
import { BorderLayer } from "./borders";
import { FireLayer, HotspotLayer, PerimeterLayer, SmokeLayer } from "./fires";
import { ForecastLegend } from "./ForecastLegend";
import { AirQualityLayer } from "./air";
import { AirQualityLegend } from "./AirQualityLegend";
import { GLProvider, useGL } from "./gl";
import { provideIcons } from "./icons";
import { AlertLayer, AlertPickPopup, DamageLayer, OutlookLayer, ReportLayer, UserLocationMarker } from "./layers";
import { OutlookLegend } from "./OutlookLegend";
import { PrecipTypeLegend } from "./PrecipTypeLegend";
import { FrameLayer, FrameTimeline, useFramePlayback } from "./radar";
import { TropicalAreas, TropicalTracks } from "./tropical";
import { WildfireLegend } from "./WildfireLegend";

/**
 * The map: one MapLibre GL map, its basemap and every storm layer.
 *
 * Layer order lives in `map-style.ts` (its slots); each layer component adds
 * itself to its slot. Zoom levels count 512-pixel tiles, so they run one
 * less than most web maps' for the same scale.
 */

// MapLibre's tile worker isn't in the bundle; this server hands it out (see `/map-worker`).
setWorkerUrl(`/map-worker?v=${getVersion()}`);

const NO_FRAMES: RadarFrame[] = [];

const US: [[number, number], [number, number]] = [
  [US_BOUNDS[0][1], US_BOUNDS[0][0]],
  [US_BOUNDS[1][1], US_BOUNDS[1][0]],
];

/** Tilted past this, the map raises its terrain. */
const TERRAIN_PITCH = 5;

export default function StormMap({ active }: { active: boolean }) {
  const { alerts, reports, damageAreas, filters } = useFilteredData();
  const {
    outlook,
    radar,
    tropical,
    forecast,
    fires,
    hotspots,
    smoke,
    air,
    alerts: alertFeed,
    reports: reportFeed,
  } = useStormData();
  const location = useLocation();
  const theme = useTheme();

  const [showFilters, setShowFilters] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState<StormAlert | null>(null);
  const [selectedReport, setSelectedReport] = useState<StormReport | null>(null);
  const [selectedStorm, setSelectedStorm] = useState<TropicalStorm | null>(null);
  const [selectedFire, setSelectedFire] = useState<WildfireIncident | null>(null);
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
  const imageryOn = radarFrames.length > 0 || forecastData !== null;
  const radarPlayback = useFramePlayback(radarFrames, "newest-first");
  const forecastPlayback = useFramePlayback(forecastFrames, "oldest-first");
  const outlookData = outlook.data;
  const tropicalData = filters.showTropical ? tropical.data : null;
  const fireData = filters.showFires ? fires.data : null;
  const hotspotData = filters.showHotspots ? (hotspots.data?.hotspots ?? null) : null;
  // Hotspot ages are measured from the poll that brought them, so a redraw never recolors them.
  const hotspotsAt = hotspots.updatedAt ?? 0;
  const smokeData = filters.showSmoke ? smoke.data : null;
  const airData = filters.showAirQuality ? air.data : null;
  const showWildfireLegend = filters.showFires || filters.showHotspots || filters.showSmoke;

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
    fires.error && "wildfires",
    hotspots.error && "hotspots",
    smoke.error && "smoke",
    air.error && "air quality",
  ].filter(Boolean);

  const locate = async () => {
    const fix = await location.request();
    if (fix) flyTo(fix, 8);
  };

  const [pitched, setPitched] = useState(false);
  const style: StyleOptions = { theme, muted: imageryOn, terrain: pitched };
  const { container, gl } = useGLMap(style, setPitched);

  return (
    <div className="relative h-full w-full">
      <div ref={container} className="h-full w-full" />
      {gl && (
        <GLProvider map={gl}>
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
          {outlookData && <OutlookLayer data={outlookData} theme={theme} />}
          {smokeData && <SmokeLayer plumes={smokeData.plumes} />}
          <DamageLayer areas={damageAreas} />
          {tropicalData && <TropicalAreas data={tropicalData} theme={theme} />}
          <AlertLayer alerts={alerts} onPick={pickAt} />
          {fireData && (
            <PerimeterLayer perimeters={fireData.perimeters} incidents={fireData.incidents} onSelect={setSelectedFire} />
          )}
          <BorderLayer theme={theme} />
          {tropicalData && <TropicalTracks data={tropicalData} theme={theme} onSelect={setSelectedStorm} />}
          {airData && <AirQualityLayer sites={airData.sites} />}
          {hotspotData && <HotspotLayer hotspots={hotspotData} now={hotspotsAt} />}
          {fireData && <FireLayer incidents={fireData.incidents} onSelect={setSelectedFire} />}
          <ReportLayer reports={reports} onSelect={setSelectedReport} />
          {location.coord && <UserLocationMarker at={location.coord} accuracy={location.accuracy} />}
          {pick && (
            <AlertPickPopup
              key={pick.n}
              at={pick.at}
              alerts={pick.alerts}
              onSelect={setSelectedAlert}
              onClose={closePick}
            />
          )}
          <FitOnShow active={active} />
          {recenter && <Recenter key={recenter.n} to={recenter.to} zoom={recenter.zoom} />}
        </GLProvider>
      )}

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
        {showWildfireLegend && (
          <div className="pointer-events-auto">
            <WildfireLegend
              fires={filters.showFires}
              hotspots={filters.showHotspots}
              smokeDate={filters.showSmoke ? (smokeData?.date ?? "") : null}
            />
          </div>
        )}
        {filters.showAirQuality && (
          <div className="pointer-events-auto">
            <AirQualityLegend hour={airData?.hour ?? null} />
          </div>
        )}
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
      {selectedFire && (
        <FireDetail
          // Show the latest numbers even if the sheet was opened from an older poll.
          fire={fireData?.incidents.find((f) => f.id === selectedFire.id) ?? selectedFire}
          perimeter={fireData?.perimeters.find((p) => p.id === selectedFire.id) ?? null}
          onClose={() => setSelectedFire(null)}
        />
      )}
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
 * The map itself, created once, and its style kept in step with `options`:
 * a new theme, fading or tilt restyles it in place, overlays and all.
 * `gl` is null until the first style has loaded.
 */
function useGLMap(options: StyleOptions, onPitched: (pitched: boolean) => void) {
  const container = useRef<HTMLDivElement>(null);
  const [gl, setGl] = useState<GLMap | null>(null);
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    const map = new GLMap({
      container: container.current!,
      style: buildStyle(latest.current),
      center: [-96, 38],
      zoom: 3,
      minZoom: 2,
      maxZoom: 18,
      maxPitch: 70,
      attributionControl: false,
    });
    map.addControl(new NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(new AttributionControl({ compact: true }), "bottom-right");
    // Compact attribution starts open on a wide map, over the storm layers; start it folded.
    map.once("load", () =>
      map.getContainer().querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"),
    );
    const stopIcons = provideIcons(map);
    map.on("pitchend", () => onPitched(map.getPitch() > TERRAIN_PITCH));
    map.once("load", () => setGl(map));
    return () => {
      stopIcons();
      map.remove();
      setGl(null);
    };
  }, [onPitched]);

  const { theme, muted, terrain } = options;
  useEffect(() => {
    gl?.setStyle(buildStyle({ theme, muted, terrain }), { transformStyle: keepOverlays });
  }, [gl, theme, muted, terrain]);

  return { container, gl };
}

/**
 * The map sits in a container that may be hidden when it mounts (the first
 * page opened wasn't the map), so MapLibre can settle on a zero size.
 * Re-measure whenever it's shown, and frame the continental US the first time
 * it has real dimensions.
 */
function FitOnShow({ active }: { active: boolean }) {
  const { map } = useGL();
  const framed = useRef(false);
  useEffect(() => {
    if (!active) return;
    const id = window.setTimeout(() => {
      map.resize();
      if (!framed.current && map.getContainer().clientHeight > 0) {
        map.fitBounds(US, { animate: false });
        framed.current = true;
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [active, map]);
  return null;
}

/** Fly to a point, zooming in to at least `zoom` (never out). */
function Recenter({ to, zoom }: { to: LatLng; zoom: number }) {
  const { map } = useGL();
  useEffect(() => {
    map.flyTo({ center: [to[1], to[0]], zoom: Math.max(map.getZoom(), zoom), duration: 800 });
  }, [map, to, zoom]);
  return null;
}
