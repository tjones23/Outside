"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { collection, line } from "@/lib/map-features";
import { lineLayer } from "@/lib/map-style";
import type { Theme } from "@/lib/theme";
import type { LatLng } from "@/lib/types";
import { useOverlay } from "./gl";

/**
 * State, province and country borders, drawn over radar and warnings.
 *
 * The basemaps have these in their base, but faint and underneath
 * everything — once radar is on they all but disappear. The lines come from
 * `public/borders.json` (built by `scripts/build-borders.ts`).
 */

type Borders = { states: LatLng[][]; countries: LatLng[][] };

/** One load per page: borders never change. */
let loading: Promise<Borders | null> | null = null;

function loadBorders(): Promise<Borders | null> {
  loading ??= fetch("/borders.json")
    .then((response) => (response.ok ? (response.json() as Promise<Borders>) : null))
    // Without them the basemap's own faint borders still show.
    .catch(() => null);
  return loading;
}

/** Light lines on the dark canvas, dark on the light; countries a step bolder. */
const STYLE: Record<Theme, { states: { stroke: string; so: number }; countries: { stroke: string; so: number } }> = {
  dark: { states: { stroke: "#D8D8E4", so: 0.55 }, countries: { stroke: "#F2F2F7", so: 0.8 } },
  light: { states: { stroke: "#3A3A48", so: 0.5 }, countries: { stroke: "#1B1B23", so: 0.7 } },
};

const BORDER_LAYERS = [lineLayer()];

export const BorderLayer = memo(function BorderLayer({ theme }: { theme: Theme }) {
  const [borders, setBorders] = useState<Borders | null>(null);

  useEffect(() => {
    let live = true;
    loadBorders().then((b) => live && setBorders(b));
    return () => {
      live = false;
    };
  }, []);

  const features = useMemo(() => {
    if (!borders) return null;
    const style = STYLE[theme];
    return collection([
      ...borders.states.map((l) => line(l, { ...style.states, w: 1 })),
      ...borders.countries.map((l) => line(l, { ...style.countries, w: 1.75 })),
    ]);
  }, [borders, theme]);
  useOverlay("borders", "borders", features, BORDER_LAYERS);
  return null;
});
