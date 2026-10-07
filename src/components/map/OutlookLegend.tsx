"use client";

import { useState } from "react";
import { featureColors } from "@/lib/outlook";
import type { Theme } from "@/lib/theme";
import type { OutlookData } from "@/lib/types";

/** Distinct outlook areas in the order SPC lists them (lowest risk first). */
export function OutlookLegend({ data, theme }: { data: OutlookData; theme: Theme }) {
  const [open, setOpen] = useState(true);
  const seen = new Set<string>();
  const items = data.features.filter((f) => {
    const key = f.label + f.detail;
    if (!f.label || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return (
    <div className="rounded-xl border border-line bg-ink/85 px-3 py-2 text-xs shadow-lg backdrop-blur-md">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 font-medium text-text"
      >
        {data.product.center} {data.product.title}
        <span className="ml-auto text-muted-dim">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1">
          {items.slice(0, 8).map((f) => {
            const { fill, stroke } = featureColors(f, theme);
            return (
              <li key={f.label + f.detail} className="flex items-center gap-2 text-muted">
                <span
                  aria-hidden="true"
                  className="h-3 w-3 shrink-0 rounded-sm border"
                  style={
                    f.isHatched
                      ? {
                          borderColor: stroke,
                          backgroundImage: `repeating-linear-gradient(45deg, ${stroke} 0 1px, transparent 1px 4px)`,
                        }
                      : { background: fill, borderColor: stroke }
                  }
                />
                {f.detail || f.label}
              </li>
            );
          })}
          {items.length === 0 && <li className="text-muted-dim">No risk areas</li>}
        </ul>
      )}
    </div>
  );
}
