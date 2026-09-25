"use client";

import { CATEGORIES, categoryColor, categoryGlyph, categoryName } from "@/lib/categories";
import { useFilters } from "@/lib/client-store";
import { isEnabled } from "@/lib/filters";
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

/** Warnings / Watches on-off chips. */
export function AlertKindChips() {
  const { filters, update } = useFilters();
  return (
    <div className="flex flex-wrap gap-2">
      <Chip on={filters.showWarnings} color="#ef4444" onClick={() => update({ showWarnings: !filters.showWarnings })}>
        Warnings
      </Chip>
      <Chip on={filters.showWatches} color="#f5b400" onClick={() => update({ showWatches: !filters.showWatches })}>
        Watches
      </Chip>
    </div>
  );
}
