"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { selectedOutlook } from "@/lib/filters";
import { useFilters } from "@/lib/client-store";
import type {
  AirQualityData,
  ForecastFrames,
  Hotspot,
  OutlookData,
  PrecipTypeManifest,
  ReportsData,
  SmokeData,
  StormAlert,
  TropicalData,
  WildfireData,
} from "@/lib/types";
import { usePoll, type Feed } from "./usePoll";

/**
 * The storm feeds, polled from the server's `/api/*` routes.
 *
 * Unfiltered on purpose: the server returns the same data to everyone so its
 * cache serves every browser, and each page applies its own filters (see
 * `useFilteredData`). Which feeds are polled does depend on settings — no
 * outlook requests while none is selected, no radar while radar is off, no
 * tropical, forecast, wildfire or air-quality requests while those are off.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;

interface StormData {
  alerts: Feed<{ alerts: StormAlert[] }>;
  reports: Feed<ReportsData>;
  outlook: Feed<OutlookData>;
  /** Radar (NOAA MRMS, colored rain vs. snow), while radar is on. */
  radar: Feed<{ manifest: PrecipTypeManifest }>;
  tropical: Feed<TropicalData>;
  forecast: Feed<ForecastFrames>;
  fires: Feed<WildfireData>;
  hotspots: Feed<{ hotspots: Hotspot[] }>;
  smoke: Feed<SmokeData>;
  air: Feed<AirQualityData>;
  /** Poll every active feed now. */
  refresh: () => void;
}

const StormDataContext = createContext<StormData | null>(null);

export function StormDataProvider({ children }: { children: ReactNode }) {
  // The map's layers decide which feeds run; the map is always mounted.
  const { filters } = useFilters("map");
  const { filters: reportFilters } = useFilters("reports");
  const [refreshToken, setRefreshToken] = useState(0);
  const refresh = useCallback(() => setRefreshToken((n) => n + 1), []);

  const product = selectedOutlook(filters);
  // Enough days for whichever page wants more; the other trims its copy.
  const reportDays = Math.max(filters.reportDays, reportFilters.reportDays);

  // Alerts keep polling in a background tab: that's what lets a warning
  // notification arrive while you're looking at something else.
  const alerts = usePoll<{ alerts: StormAlert[] }>("/api/alerts", MINUTE, {
    whenHidden: true,
    refreshToken,
  });
  const reports = usePoll<ReportsData>(`/api/reports?days=${reportDays}`, 5 * MINUTE, {
    whenHidden: false,
    keepPrevious: true,
    refreshToken,
  });
  const outlook = usePoll<OutlookData>(
    product ? `/api/outlook?day=${product.day}&kind=${product.kind}` : null,
    15 * MINUTE,
    { whenHidden: false, refreshToken },
  );
  // Radar frames are drawn by the server on demand, so while it's still
  // drawing the last hour, poll every 15 seconds to pick them up. The
  // interval follows the last answer, carried over from the render it came in.
  const [radarPending, setRadarPending] = useState(false);
  const radar = usePoll<{ manifest: PrecipTypeManifest }>(
    filters.showRadar ? "/api/mrms" : null,
    radarPending ? 15 * SECOND : 3 * MINUTE,
    { whenHidden: false, refreshToken },
  );
  const pendingNow = radar.data?.manifest.pending ?? false;
  if (pendingNow !== radarPending) setRadarPending(pendingNow);

  const tropical = usePoll<TropicalData>(filters.showTropical ? "/api/tropical" : null, 10 * MINUTE, {
    whenHidden: false,
    refreshToken,
  });
  const forecast = usePoll<ForecastFrames>(
    filters.forecastProduct ? `/api/forecast?product=${filters.forecastProduct}` : null,
    10 * MINUTE,
    { whenHidden: false, refreshToken },
  );

  const fires = usePoll<WildfireData>(filters.showFires ? "/api/fires" : null, 5 * MINUTE, {
    whenHidden: false,
    refreshToken,
  });
  const hotspots = usePoll<{ hotspots: Hotspot[] }>(filters.showHotspots ? "/api/hotspots" : null, 15 * MINUTE, {
    whenHidden: false,
    refreshToken,
  });
  const smoke = usePoll<SmokeData>(filters.showSmoke ? "/api/smoke" : null, 30 * MINUTE, {
    whenHidden: false,
    refreshToken,
  });

  const air = usePoll<AirQualityData>(filters.showAirQuality ? "/api/air" : null, 15 * MINUTE, {
    whenHidden: false,
    refreshToken,
  });

  const value = useMemo(
    () => ({ alerts, reports, outlook, radar, tropical, forecast, fires, hotspots, smoke, air, refresh }),
    [alerts, reports, outlook, radar, tropical, forecast, fires, hotspots, smoke, air, refresh],
  );
  return <StormDataContext.Provider value={value}>{children}</StormDataContext.Provider>;
}

export function useStormData(): StormData {
  const value = useContext(StormDataContext);
  if (!value) throw new Error("useStormData must be used inside <StormDataProvider>");
  return value;
}
