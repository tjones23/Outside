"use client";

import { ALERT_GROUPS, alertGroupColor, alertGroupGlyph, alertGroupName } from "@/lib/alert-catalog";
import { CATEGORIES, categoryColor, categoryGlyph, categoryName } from "@/lib/categories";
import { useFilters } from "@/lib/client-store";
import { isEnabled, isGroupEnabled } from "@/lib/filters";
import type { FilterSettings } from "@/lib/types";
import { Chip } from "./ui/controls";

/** Tornado / Wind / Hail on-off chips (the mobile app's category bar). */
export function CategoryChips() {
  const { filters, toggleCategory } = useFilters();
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
export function AlertKindChips() {
  const { filters, update } = useFilters();
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
export function AlertGroupChips() {
  const { filters, toggleAlertGroup } = useFilters();
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
