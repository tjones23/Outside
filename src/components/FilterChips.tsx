"use client";

import { ALERT_GROUPS, alertGroupColor, alertGroupGlyph, alertGroupName } from "@/lib/alert-catalog";
import { CATEGORIES, categoryColor, categoryGlyph, categoryName } from "@/lib/categories";
import { useFilters } from "@/lib/client-store";
import {
  isEnabled,
  isGroupEnabled,
  REPORT_DAY_OPTIONS,
  WIND_MAX,
  WIND_MIN,
  type FilterScope,
} from "@/lib/filters";
import type { FilterSettings } from "@/lib/types";
import { Chip } from "./ui/controls";

/** Tornado / Wind / Hail on-off chips (the mobile app's category bar). */
export function CategoryChips({ scope }: { scope: FilterScope }) {
  const { filters, toggleCategory } = useFilters(scope);
  return (
    <div className="flex flex-wrap gap-2">
      {CATEGORIES.map((c) => (
        <Chip key={c} on={isEnabled(filters, c)} color={categoryColor(c)} onClick={() => toggleCategory(c)}>
          <span aria-hidden="true">{categoryGlyph(c)}</span>
          {categoryName(c)}
        </Chip>
      ))}
    </div>
  );
}

const TIERS: { key: keyof FilterSettings & `show${string}`; label: string; color: string }[] = [
  { key: "showWarnings", label: "Warnings", color: "#ef4444" },
  { key: "showWatches", label: "Watches", color: "#f5b400" },
  { key: "showAdvisories", label: "Advisories", color: "#a78bfa" },
  { key: "showStatements", label: "Statements", color: "#94a3b8" },
];

/** Warnings / Watches / Advisories / Statements on-off chips. */
export function AlertKindChips({ scope }: { scope: FilterScope }) {
  const { filters, update } = useFilters(scope);
  return (
    <div className="flex flex-wrap gap-2">
      {TIERS.map((t) => (
        <Chip key={t.key} on={filters[t.key] as boolean} color={t.color} onClick={() => update({ [t.key]: !filters[t.key] })}>
          {t.label}
        </Chip>
      ))}
    </div>
  );
}

/** The hazard families — severe, tropical, flood, coastal, heat… — on and off. */
export function AlertGroupChips({ scope }: { scope: FilterScope }) {
  const { filters, toggleAlertGroup } = useFilters(scope);
  return (
    <div className="flex flex-wrap gap-2">
      {ALERT_GROUPS.map((g) => (
        <Chip key={g} on={isGroupEnabled(filters, g)} color={alertGroupColor(g)} onClick={() => toggleAlertGroup(g)}>
          <span aria-hidden="true">{alertGroupGlyph(g)}</span>
          {alertGroupName(g)}
        </Chip>
      ))}
    </div>
  );
}

/** Today / 2 days / 3 days / 5 days. */
export function ReportDayChips({ scope }: { scope: FilterScope }) {
  const { filters, update } = useFilters(scope);
  return (
    <div className="flex flex-wrap gap-2">
      {REPORT_DAY_OPTIONS.map((d) => (
        <Chip key={d} on={filters.reportDays === d} onClick={() => update({ reportDays: d })}>
          {d === 1 ? "Today" : `${d} days`}
        </Chip>
      ))}
    </div>
  );
}

// The notches each minimum-magnitude chip steps through; the first is "no minimum".
const WIND_STOPS = [0, WIND_MIN, 65, 70, 75, WIND_MAX];
const HAIL_STOPS = [0, 0.75, 1, 1.75, 2.5];
const TORNADO_STOPS = [null, 0, 1, 2, 3, 4, 5];

/** The notch after `value`, wrapping to the first. A value between notches moves up to the next. */
function nextStop<T extends number | null>(stops: readonly T[], value: T): T {
  const i = stops.findIndex((s) => (s ?? -1) > (value ?? -1));
  return i === -1 ? stops[0] : stops[i];
}

/** Wind / hail / tornado minimums, each a chip that steps to its next notch on tap. */
export function MagnitudeChips({ scope }: { scope: FilterScope }) {
  const { filters: f, update } = useFilters(scope);
  return (
    <div className="flex flex-wrap gap-2">
      <Chip
        on={f.minWindMph > 0}
        color={categoryColor("wind")}
        onClick={() => update({ minWindMph: nextStop(WIND_STOPS, f.minWindMph) })}
        title="Minimum wind speed"
      >
        {f.minWindMph > 0 ? `Wind ${f.minWindMph}+ mph` : "Any wind"}
      </Chip>
      <Chip
        on={f.minHailInches > 0}
        color={categoryColor("hail")}
        onClick={() => update({ minHailInches: nextStop(HAIL_STOPS, f.minHailInches) })}
        title="Minimum hail size · penny ≈ 0.75″ · quarter ≈ 1.00″ · golf ball ≈ 1.75″"
      >
        {f.minHailInches > 0 ? `Hail ${f.minHailInches.toFixed(2)}″+` : "Any hail"}
      </Chip>
      <Chip
        on={f.minTornadoRating !== null}
        color={categoryColor("tornado")}
        onClick={() => update({ minTornadoRating: nextStop(TORNADO_STOPS, f.minTornadoRating) })}
        title="Minimum tornado rating"
      >
        {f.minTornadoRating === null ? "Any tornado" : `EF${f.minTornadoRating}+`}
      </Chip>
    </div>
  );
}
