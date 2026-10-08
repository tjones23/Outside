"use client";

import { memo, useEffect, useState } from "react";
import { Polyline } from "react-leaflet";
import type { Theme } from "@/lib/theme";
import type { LatLng } from "@/lib/types";

/**
 * State, province and country borders, drawn over radar and warnings.
 *
 * Esri's gray canvases have these baked into the base tiles, but faint and
 * underneath everything — once radar is on they all but disappear. The lines
 * come from `public/borders.json` (built by `scripts/build-borders.ts`).
 */

type Borders = { states: LatLng[][]; countries: LatLng[][] };

/** One load per page: borders never change, and the map remounts with its host. */
let loading: Promise<Borders | null> | null = null;

function loadBorders(): Promise<Borders | null> {
  loading ??= fetch("/borders.json")
    .then((response) => (response.ok ? (response.json() as Promise<Borders>) : null))
    // Without them the base tiles' own faint borders still show.
    .catch(() => null);
  return loading;
}

/** Light lines on the dark canvas, dark on the light; countries a step bolder. */
const STYLE: Record<Theme, { states: { color: string; opacity: number }; countries: { color: string; opacity: number } }> = {
  dark: { states: { color: "#D8D8E4", opacity: 0.55 }, countries: { color: "#F2F2F7", opacity: 0.8 } },
  light: { states: { color: "#3A3A48", opacity: 0.5 }, countries: { color: "#1B1B23", opacity: 0.7 } },
};

export const BorderLayer = memo(function BorderLayer({ theme }: { theme: Theme }) {
  const [borders, setBorders] = useState<Borders | null>(null);

  useEffect(() => {
    let live = true;
    loadBorders().then((b) => live && setBorders(b));
    return () => {
      live = false;
    };
  }, []);

  if (!borders) return null;
  const style = STYLE[theme];
  return (
    <>
      <Polyline positions={borders.states} interactive={false} pathOptions={{ ...style.states, weight: 1 }} />
      <Polyline positions={borders.countries} interactive={false} pathOptions={{ ...style.countries, weight: 1.75 }} />
    </>
  );
});
