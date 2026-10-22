"use client";

import { maplibreGL } from "@maplibre/maplibre-gl-leaflet";
import { getVersion, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import { exploreStyle, type ExplorePart } from "@/lib/explore-style";
import type { Theme } from "@/lib/theme";

setWorkerUrl(`/map-worker?v=${getVersion()}`);

/**
 * One part of the Explore basemap (see `lib/explore-style.ts`): a MapLibre GL
 * map that follows the Leaflet map from inside a Leaflet pane. The base goes
 * in the tile pane, the labels in the labels pane above radar and warnings.
 *
 * `muted` washes the colors out while radar or a forecast animation is on,
 * so green forest and blue water don't read as precipitation.
 */
export function ExploreLayer({
  part,
  theme,
  pane,
  muted = false,
}: {
  part: ExplorePart;
  theme: Theme;
  pane: string;
  muted?: boolean;
}) {
  const map = useMap();
  const layer = useRef<ReturnType<typeof maplibreGL> | null>(null);
  const styled = useRef(theme);

  // Built once per pane; theme changes restyle it in place.
  useEffect(() => {
    // `pane` is a Leaflet layer option the plugin's types leave out.
    const options = {
      style: exploreStyle(theme, part),
      pane,
      // The labels share the base's sources, so only the base credits them.
      ...(part === "labels" ? { attributionControl: false as const } : {}),
    };
    const gl = maplibreGL(options);
    gl.addTo(map);
    layer.current = gl;
    styled.current = theme;
    return () => {
      gl.remove();
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- theme is applied by the effect below
  }, [map, part, pane]);

  useEffect(() => {
    if (styled.current === theme) return;
    styled.current = theme;
    layer.current?.getMaplibreMap()?.setStyle(exploreStyle(theme, part));
  }, [theme, part]);

  useEffect(() => {
    const container = layer.current?.getContainer();
    if (container) container.style.filter = muted ? "saturate(0.35)" : "";
  }, [muted]);

  return null;
}
