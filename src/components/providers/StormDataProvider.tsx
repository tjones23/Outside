"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { selectedOutlook } from "@/lib/filters";
import { useFilters } from "@/lib/client-store";
import type {
  ForecastFrames,
  OutlookData,
  PrecipTypeManifest,
  RadarManifest,
  ReportsData,
  StormAlert,
  TropicalData,
} from "@/lib/types";
import { usePoll, type Feed } from "./usePoll";

/**
 * The storm feeds, polled from the server's `/api/*` routes.
 *
 * Unfiltered on purpose: the server returns the same data to everyone so its
 * cache serves every browser, and each browser applies its own filters (see
 * `useFilteredData`). Which feeds are polled does depend on settings — no
 * outlook requests while none is selected, no radar while radar is off, no
 * tropical or forecast requests while those are off.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;

interface StormData {
  alerts: Feed<{ alerts: StormAlert[] }>;
  reports: Feed<ReportsData>;
  outlook: Feed<OutlookData>;
  radar: Feed<{ manifest: RadarManifest | null }>;
  /** Rain-and-snow radar (NOAA MRMS), while radar and that option are on. */
  precipType: Feed<{ manifest: PrecipTypeManifest }>;
  tropical: Feed<TropicalData>;
  forecast: Feed<ForecastFrames>;
  /** Poll every active feed now. */
  refresh: () => void;
}

const StormDataContext = createContext<StormData | null>(null);

export function StormDataProvider({ children }: { children: ReactNode }) {
  const { filters } = useFilters();
  const [refreshToken, setRefreshToken] = useState(0);
  const refresh = useCallback(() => setRefreshToken((n) => n + 1), []);

  const product = selectedOutlook(filters);

  // Alerts keep polling in a background tab: that's what lets a warning
  // notification arrive while you're looking at something else.
  const alerts = usePoll<{ alerts: StormAlert[] }>("/api/alerts", MINUTE, {
    whenHidden: true,
    refreshToken,
  });
  const reports = usePoll<ReportsData>(`/api/reports?days=${filters.reportDays}`, 5 * MINUTE, {
    whenHidden: false,
    keepPrevious: true,
    refreshToken,
  });
  const outlook = usePoll<OutlookData>(
    product ? `/api/outlook?day=${product.day}&kind=${product.kind}` : null,
    15 * MINUTE,
    { whenHidden: false, refreshToken },
  );
  // Rain-and-snow frames are drawn by the server on demand, so while it's
  // still drawing the last hour, poll every 15 seconds to pick them up. The
  // interval follows the last answer, carried over from the render it came in.
  const [precipTypePending, setPrecipTypePending] = useState(false);
  const precipType = usePoll<{ manifest: PrecipTypeManifest }>(
    filters.showRadar && filters.radarPrecipType ? "/api/mrms" : null,
    precipTypePending ? 15 * SECOND : 3 * MINUTE,
    { whenHidden: false, refreshToken },
  );
  const pendingNow = precipType.data?.manifest.pending ?? false;
  if (pendingNow !== precipTypePending) setPrecipTypePending(pendingNow);
  // RainViewer is the radar when rain-and-snow is off, and the fallback when
  // it can't be had: NOAA unreachable, or nothing drawn.
  const precipFrames = precipType.data?.manifest.frames.length ?? 0;
  const precipTypeUnavailable = precipType.error !== null || (precipType.data !== null && precipFrames === 0 && !pendingNow);
  const radar = usePoll<{ manifest: RadarManifest | null }>(
    filters.showRadar && (!filters.radarPrecipType || precipTypeUnavailable) ? "/api/radar" : null,
    3 * MINUTE,
    { whenHidden: false, refreshToken },
  );

  const tropical = usePoll<TropicalData>(filters.showTropical ? "/api/tropical" : null, 10 * MINUTE, {
    whenHidden: false,
    refreshToken,
  });
  const forecast = usePoll<ForecastFrames>(
    filters.forecastProduct ? `/api/forecast?product=${filters.forecastProduct}` : null,
    10 * MINUTE,
    { whenHidden: false, refreshToken },
  );

  const value = useMemo(
    () => ({ alerts, reports, outlook, radar, precipType, tropical, forecast, refresh }),
    [alerts, reports, outlook, radar, precipType, tropical, forecast, refresh],
  );
  return <StormDataContext.Provider value={value}>{children}</StormDataContext.Provider>;
}

export function useStormData(): StormData {
  const value = useContext(StormDataContext);
  if (!value) throw new Error("useStormData must be used inside <StormDataProvider>");
  return value;
}
