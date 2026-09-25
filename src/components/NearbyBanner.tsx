"use client";

import { categoryColor, categoryGlyph } from "@/lib/categories";
import { formatDateTime, formatMiles } from "@/lib/format";
import { NEARBY_RADIUS_MILES, reportsNear, warningsContaining } from "@/lib/nearby";
import { useLocation } from "./providers/LocationProvider";
import { useFilteredData } from "./providers/useFilteredData";

/**
 * "You are in a Tornado Warning" / "3 recent reports near you" — shown once
 * the viewer's location is known.
 */
export function NearbyBanner({ onSelectAlert }: { onSelectAlert?: (id: string) => void }) {
  const { coord } = useLocation();
  const { allAlerts, reports } = useFilteredData();
  if (!coord) return null;

  // Every warning, regardless of filters: being inside one always matters.
  const warning = warningsContaining(allAlerts, coord)[0];
  if (warning) {
    return (
      <button
        type="button"
        onClick={() => onSelectAlert?.(warning.id)}
        className="w-full rounded-xl px-4 py-2.5 text-left text-sm font-medium text-white shadow-lg"
        style={{ background: warning.color }}
      >
        <span className="block">You are in a {warning.event}</span>
        {warning.expires && (
          <span className="block text-xs font-normal opacity-90">Until {formatDateTime(warning.expires)}</span>
        )}
      </button>
    );
  }

  const near = reportsNear(reports, coord);
  if (near.length === 0) return null;
  const closest = near[0];
  return (
    <div
      className="rounded-xl border border-line bg-ink/85 px-4 py-2.5 text-sm shadow-lg backdrop-blur-md"
      style={{ borderLeft: `4px solid ${categoryColor(closest.report.category)}` }}
    >
      <span className="block font-medium">
        {near.length} recent report{near.length === 1 ? "" : "s"} within {NEARBY_RADIUS_MILES} mi
      </span>
      <span className="block text-xs text-muted">
        Closest: {categoryGlyph(closest.report.category)} {closest.report.title} · {formatMiles(closest.miles)}
      </span>
    </div>
  );
}
