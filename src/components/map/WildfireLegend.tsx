"use client";

import { useState, type ReactNode } from "react";
import { Flame } from "./fires";
import { SMOKE_DENSITIES } from "@/lib/smoke";
import { CONTAINMENT_BANDS, HOTSPOT_AGES } from "@/lib/wildfire";

/** "2026-10-11" → "Oct 11". */
function dayName(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString([], { month: "short", day: "numeric", timeZone: "UTC" });
}

/** One key for every wildfire layer that's on: fires, hotspots, smoke. */
export function WildfireLegend({
  fires,
  hotspots,
  smokeDate,
}: {
  fires: boolean;
  hotspots: boolean;
  /** The HMS day being shown; null while smoke is off. */
  smokeDate: string | null;
}) {
  // Starts folded: fires are on by default, and the map's corner is shared with other keys.
  const [open, setOpen] = useState(false);

  return (
    <div className="max-w-xs rounded-xl border border-line bg-ink/85 px-3 py-2 text-xs shadow-lg backdrop-blur-md">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 font-medium text-text"
      >
        Wildfire
        <span className="ml-auto text-muted-dim">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="mt-1.5 space-y-2">
          {fires && (
            <Group>
              {CONTAINMENT_BANDS.map((b) => (
                <Item key={b.band} label={b.label}>
                  <Flame color={b.color} className="h-3.5 w-3.5" />
                </Item>
              ))}
            </Group>
          )}
          {hotspots && (
            <Group heading="Satellite hotspots">
              {HOTSPOT_AGES.map((a) => (
                <Item key={a.hours} label={a.label}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: a.color }} />
                </Item>
              ))}
            </Group>
          )}
          {smokeDate !== null && (
            <Group heading={smokeDate ? `Smoke · ${dayName(smokeDate)} (UTC)` : "Smoke"}>
              {SMOKE_DENSITIES.map((d) => (
                <Item key={d.density} label={d.label}>
                  <span className="h-2.5 w-3 rounded-sm" style={{ background: d.color, opacity: 0.75 }} />
                </Item>
              ))}
            </Group>
          )}
        </div>
      )}
    </div>
  );
}

function Group({ heading, children }: { heading?: string; children: ReactNode }) {
  return (
    <div>
      {heading && <p className="mb-1 text-muted-dim">{heading}</p>}
      <ul className="space-y-1">{children}</ul>
    </div>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2 text-muted">
      <span aria-hidden="true" className="flex w-3.5 shrink-0 justify-center">
        {children}
      </span>
      {label}
    </li>
  );
}
