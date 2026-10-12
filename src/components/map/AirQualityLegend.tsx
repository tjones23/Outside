"use client";

import { useState } from "react";
import { AQI_CATEGORIES } from "@/lib/air-quality";
import { formatDateTime } from "@/lib/format";

/** EPA's AQI categories, and the hour the monitors are showing. */
export function AirQualityLegend({ hour }: { hour: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="max-w-xs rounded-xl border border-line bg-ink/85 px-3 py-2 text-xs shadow-lg backdrop-blur-md">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 font-medium text-text"
      >
        Air quality
        {hour && <span className="font-normal text-muted-dim">{formatDateTime(hour)}</span>}
        <span className="ml-auto text-muted-dim">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1">
          {AQI_CATEGORIES.map((c, i) => (
            <li key={c.label} className="flex items-center gap-2 text-muted">
              <span aria-hidden="true" className="h-2.5 w-3.5 shrink-0 rounded-sm" style={{ background: c.color }} />
              <span className="w-14 shrink-0 tabular-nums text-muted-dim">
                {i === 0 ? "0" : AQI_CATEGORIES[i - 1].max + 1}
                {Number.isFinite(c.max) ? `–${c.max}` : "+"}
              </span>
              {c.label}
            </li>
          ))}
          <li className="pt-1 text-muted-dim">EPA AirNow monitors, worst pollutant&apos;s AQI.</li>
        </ul>
      )}
    </div>
  );
}
