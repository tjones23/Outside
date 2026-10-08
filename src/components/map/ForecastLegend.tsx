"use client";

import { useState } from "react";
import { forecastProduct, ndfdLegendUrl, REFLECTIVITY_STOPS } from "@/lib/forecast";
import { formatDateTime } from "@/lib/format";
import type { ForecastFrames, ForecastProductId } from "@/lib/types";

/**
 * What the forecast colors mean. HRRR uses the familiar radar scale, drawn
 * here; NDFD's scales come as images from NWS's own map viewer.
 */
export function ForecastLegend({ id, data }: { id: ForecastProductId; data: ForecastFrames | null }) {
  const [open, setOpen] = useState(true);
  const product = forecastProduct(id);
  const run = data?.runTime ? formatDateTime(new Date(data.runTime * 1000).toISOString()) : null;

  return (
    <div className="w-full max-w-md rounded-xl border border-line bg-ink/85 px-3 py-2 text-xs shadow-lg backdrop-blur-md">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 font-medium text-text"
      >
        {product.name}
        <span className="font-normal text-muted-dim">· {product.units}</span>
        <span className="ml-auto text-muted-dim">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="mt-1.5">
          {product.ndfd ? (
            // A plain <img>: it's NWS's legend, not an asset Next can optimize.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={ndfdLegendUrl(product.ndfd.element)}
              alt={`${product.name} color scale, ${product.units}`}
              className="h-auto w-full rounded"
              width={600}
              height={30}
            />
          ) : (
            <ScaleBar stops={REFLECTIVITY_STOPS} />
          )}
          <span className="mt-1 block text-muted-dim">
            {product.source}
            {run && ` · run ${run}`}
          </span>
        </div>
      )}
    </div>
  );
}

/** A color bar with its dBZ marks every 15, from 5. */
export function ScaleBar({ stops, ticks = true }: { stops: [dbz: number, color: string][]; ticks?: boolean }) {
  const n = stops.length;
  const gradient = stops.map(([, color], i) => `${color} ${(i / (n - 1)) * 100}%`).join(", ");
  return (
    <div>
      <div className="h-2.5 rounded-sm" style={{ background: `linear-gradient(to right, ${gradient})` }} />
      {ticks && (
        <div className="mt-0.5 flex justify-between text-[10px] tabular-nums text-muted-dim">
          {stops
            .filter(([dbz]) => dbz % 15 === 5)
            .map(([dbz]) => (
              <span key={dbz}>{dbz}</span>
            ))}
        </div>
      )}
    </div>
  );
}
