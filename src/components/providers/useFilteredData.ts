"use client";

import { useMemo } from "react";
import { useFilters } from "@/lib/client-store";
import { buildDamageAreas } from "@/lib/damage-areas";
import { passesAlert, passesReport } from "@/lib/filters";
import { useStormData } from "./StormDataProvider";

/** The feeds with this browser's filters applied, plus the damage blobs. */
export function useFilteredData() {
  const { filters } = useFilters();
  const { alerts, reports } = useStormData();

  const allAlerts = alerts.data?.alerts;
  const allReports = reports.data?.reports;

  const filteredAlerts = useMemo(
    () => (allAlerts ?? []).filter((a) => passesAlert(filters, a)),
    [allAlerts, filters],
  );
  const filteredReports = useMemo(
    () => (allReports ?? []).filter((r) => passesReport(filters, r)),
    [allReports, filters],
  );
  const damageAreas = useMemo(() => buildDamageAreas(filteredReports), [filteredReports]);

  return {
    filters,
    allAlerts: allAlerts ?? [],
    alerts: filteredAlerts,
    reports: filteredReports,
    damageAreas,
  };
}
