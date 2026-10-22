"use client";

import { useMemo } from "react";
import { useFilters } from "@/lib/client-store";
import { buildDamageAreas } from "@/lib/damage-areas";
import { passesAlert, passesReport, withinReportDays, type FilterScope } from "@/lib/filters";
import { useStormData } from "./StormDataProvider";

/** The feeds with one page's filters applied, plus the damage blobs. */
export function useFilteredData(scope: FilterScope) {
  const { filters } = useFilters(scope);
  const { alerts, reports } = useStormData();

  const allAlerts = alerts.data?.alerts;
  const allReports = reports.data?.reports;
  const reportDays = reports.data?.days;

  const filteredAlerts = useMemo(
    () => (allAlerts ?? []).filter((a) => passesAlert(filters, a)),
    [allAlerts, filters],
  );
  const filteredReports = useMemo(
    () =>
      withinReportDays(allReports ?? [], reportDays ?? [], filters.reportDays).filter((r) => passesReport(filters, r)),
    [allReports, reportDays, filters],
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
