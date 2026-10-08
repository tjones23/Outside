"use client";

import { useState } from "react";
import { PRECIP_KINDS, PRECIP_SCALES, type PrecipKind } from "@/lib/precip-type";
import { ScaleBar } from "./ForecastLegend";

const LABEL: Record<PrecipKind, string> = { rain: "Rain", snow: "Snow" };

/** What the rain-and-snow radar's colors mean: one intensity scale per kind. */
export function PrecipTypeLegend() {
  const [open, setOpen] = useState(true);
  return (
    <div className="w-full max-w-md rounded-xl border border-line bg-ink/85 px-3 py-2 text-xs shadow-lg backdrop-blur-md">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 font-medium text-text"
      >
        Rain and snow
        <span className="font-normal text-muted-dim">· dBZ</span>
        <span className="ml-auto text-muted-dim">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="mt-1.5 flex flex-col gap-1">
          {PRECIP_KINDS.map((kind, i) => (
            <div key={kind} className="flex items-start gap-2">
              <span className="w-8 shrink-0 leading-[10px] text-muted">{LABEL[kind]}</span>
              <div className="min-w-0 flex-1">
                <ScaleBar stops={PRECIP_SCALES[kind]} ticks={i === PRECIP_KINDS.length - 1} />
              </div>
            </div>
          ))}
          <span className="mt-0.5 block text-muted-dim">NOAA MRMS · continental US · no sleet or freezing rain class</span>
        </div>
      )}
    </div>
  );
}
