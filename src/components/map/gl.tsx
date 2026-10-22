"use client";

import type { FeatureCollection } from "geojson";
import {
  Marker,
  Popup,
  type GeoJSONSource,
  type LayerSpecification,
  type LngLat,
  type Map as GLMap,
  type MapGeoJSONFeature,
  type MapMouseEvent,
  type PositionAnchor,
} from "maplibre-gl";
import { createContext, use, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { EMPTY } from "@/lib/map-features";
import { OVERLAY_PREFIX, slotEnd, type Slot } from "@/lib/map-style";
import type { LatLng } from "@/lib/types";

/**
 * The glue between React and the one MapLibre map: overlays as GeoJSON
 * sources with static layers, clicks routed to whichever overlay is on top,
 * and popups and HTML markers whose content React renders.
 */

type ClickHandler = (feature: MapGeoJSONFeature, at: LatLng) => void;

interface GLContext {
  map: GLMap;
  /** Overlay layer id → what a click on it does. */
  clicks: Map<string, ClickHandler>;
  /** Opens a popup, closing the one already open. Returns its cleanup. */
  showPopup: (popup: Popup) => () => void;
}

const Context = createContext<GLContext | null>(null);

function popupSlot(map: GLMap): GLContext["showPopup"] {
  let open: Popup | null = null;
  // Escape closes it, from anywhere on the map.
  map.getContainer().addEventListener("keydown", (e) => {
    if (e.key === "Escape") open?.remove();
  });
  return (popup) => {
    open?.remove();
    popup.addTo(map);
    open = popup;
    return () => {
      popup.remove();
      if (open === popup) open = null;
    };
  };
}

export function GLProvider({ map, children }: { map: GLMap; children: ReactNode }) {
  const [value] = useState<GLContext>(() => ({ map, clicks: new Map(), showPopup: popupSlot(map) }));
  useClickRouting(value);
  return <Context value={value}>{children}</Context>;
}

export function useGL(): GLContext {
  const ctx = use(Context);
  if (!ctx) throw new Error("useGL outside GLProvider");
  return ctx;
}

const toLatLng = (at: LngLat): LatLng => [at.lat, at.lng];

/** Pixels of slack around a tap, so small dots and thin lines can be hit. */
const HIT_SLOP = 4;

/** Clicks on markers and popups are theirs, not the map's. */
function onMapChrome(e: MapMouseEvent): boolean {
  const target = e.originalEvent.target;
  return target instanceof Element && target.closest(".maplibregl-marker, .maplibregl-popup") !== null;
}

/**
 * One click listener for the whole map: the topmost clickable overlay under
 * the pointer gets the click.
 * The pointer turns into a hand over anything clickable.
 */
function useClickRouting({ map, clicks }: GLContext) {
  useEffect(() => {
    const hit = (e: MapMouseEvent): MapGeoJSONFeature | undefined => {
      const layers = [...clicks.keys()].filter((id) => map.getLayer(id));
      if (layers.length === 0) return undefined;
      const { x, y } = e.point;
      return map.queryRenderedFeatures(
        [
          [x - HIT_SLOP, y - HIT_SLOP],
          [x + HIT_SLOP, y + HIT_SLOP],
        ],
        { layers },
      )[0];
    };
    const click = (e: MapMouseEvent) => {
      if (onMapChrome(e)) return;
      const feature = hit(e);
      if (feature) clicks.get(feature.layer.id)?.(feature, toLatLng(e.lngLat));
    };
    let hovering = false;
    const move = (e: MapMouseEvent) => {
      const over = !onMapChrome(e) && hit(e) !== undefined;
      if (over !== hovering) map.getCanvas().style.cursor = (hovering = over) ? "pointer" : "";
    };
    map.on("click", click);
    map.on("mousemove", move);
    return () => {
      map.off("click", click);
      map.off("mousemove", move);
    };
  }, [map, clicks]);
}

/** A layer of an overlay, minus its source, with an id unique within the overlay. */
export type OverlayLayer = LayerSpecification extends infer L
  ? L extends LayerSpecification
    ? Omit<L, "source" | "source-layer">
    : never
  : never;

export const overlayLayerId = (name: string, layer: string) => `${OVERLAY_PREFIX}${name}:${layer}`;

/**
 * An overlay: one GeoJSON source and its layers, in `slot`. `layers` must
 * keep its identity (a module constant) — styling comes from each feature's
 * properties, so new data never means new layers.
 */
export function useOverlay(name: string, slot: Slot, data: FeatureCollection | null, layers: readonly OverlayLayer[]) {
  const { map } = useGL();
  const source = `${OVERLAY_PREFIX}${name}`;

  useEffect(() => {
    map.addSource(source, { type: "geojson", data: EMPTY });
    const before = slotEnd(slot);
    for (const layer of layers) {
      map.addLayer({ ...layer, id: overlayLayerId(name, layer.id), source } as LayerSpecification, before);
    }
    return () => {
      try {
        for (const layer of layers) {
          const id = overlayLayerId(name, layer.id);
          if (map.getLayer(id)) map.removeLayer(id);
        }
        if (map.getSource(source)) map.removeSource(source);
      } catch {
        // The map is already gone, and its layers with it.
      }
    };
  }, [map, name, source, slot, layers]);

  useEffect(() => {
    map.getSource<GeoJSONSource>(source)?.setData(data ?? EMPTY);
  }, [map, source, data]);
}

/** What a click on any of an overlay's `layers` does. */
export function useOverlayClick(name: string, layers: readonly string[], handler: ClickHandler) {
  const { clicks } = useGL();
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  const key = layers.join();
  useEffect(() => {
    const ids = key.split(",").map((layer) => overlayLayerId(name, layer));
    const call: ClickHandler = (feature, at) => latest.current(feature, at);
    for (const id of ids) clicks.set(id, call);
    return () => {
      for (const id of ids) clicks.delete(id);
    };
  }, [clicks, name, key]);
}

/**
 * A popup at `at` showing `children`. Only one is open at a time: opening
 * one closes the last, which tells its owner through `onClose`.
 */
export function MapPopup({
  at,
  onClose,
  maxWidth = 300,
  offset = 8,
  children,
}: {
  at: LatLng;
  onClose: () => void;
  maxWidth?: number;
  offset?: number;
  children: ReactNode;
}) {
  const { showPopup } = useGL();
  const [el] = useState(() => document.createElement("div"));
  const latestClose = useRef(onClose);
  useEffect(() => {
    latestClose.current = onClose;
  });
  const [lat, lng] = at;

  useEffect(() => {
    const popup = new Popup({ maxWidth: `${maxWidth}px`, offset, focusAfterOpen: false })
      .setLngLat([lng, lat])
      .setDOMContent(el);
    const close = () => latestClose.current();
    const hide = showPopup(popup);
    popup.on("close", close);
    return () => {
      popup.off("close", close);
      hide();
    };
  }, [showPopup, el, lat, lng, maxWidth, offset]);

  return createPortal(children, el);
}

/** A popup's "Details" button. */
export function PopupButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 rounded-full border border-line bg-surface px-3 py-1 text-xs text-text hover:border-muted-dim"
    >
      Details
    </button>
  );
}

/**
 * An HTML element pinned to a point — for the few markers that need text,
 * CSS and their own clicks (storm positions and labels, your location).
 * The many (fires, monitors, reports) are drawn by the map instead.
 */
export function HtmlMarker({
  at,
  className,
  anchor = "center",
  zIndex = 0,
  title,
  onClick,
  children,
}: {
  at: LatLng;
  className?: string;
  anchor?: PositionAnchor;
  zIndex?: number;
  title?: string;
  onClick?: () => void;
  children?: ReactNode;
}) {
  const { map } = useGL();
  const [el] = useState(() => document.createElement("div"));
  const latestClick = useRef(onClick);
  useEffect(() => {
    latestClick.current = onClick;
  });
  const [lat, lng] = at;
  const clickable = onClick !== undefined;

  useEffect(() => {
    const marker = new Marker({ element: el, anchor }).setLngLat([lng, lat]).addTo(map);
    return () => {
      marker.remove();
    };
  }, [map, el, anchor, lat, lng]);

  useEffect(
    () => dressMarker(el, { className, zIndex, title, onClick: clickable ? () => latestClick.current?.() : undefined }),
    [el, className, zIndex, title, clickable],
  );

  return children ? createPortal(children, el) : null;
}

/** Puts a marker's class, stacking, tooltip and click on its element. Returns the cleanup. */
function dressMarker(
  el: HTMLElement,
  { className, zIndex, title, onClick }: { className?: string; zIndex: number; title?: string; onClick?: () => void },
): () => void {
  // MapLibre's own classes position the marker; ours go alongside.
  const classes = className?.split(/\s+/).filter(Boolean) ?? [];
  el.classList.add(...classes);
  el.style.zIndex = String(zIndex);
  if (title) el.title = title;
  else el.removeAttribute("title");
  if (!onClick) {
    el.style.pointerEvents = "none";
    el.removeAttribute("role");
    el.removeAttribute("tabindex");
    return () => el.classList.remove(...classes);
  }
  el.style.pointerEvents = "";
  el.setAttribute("role", "button");
  el.tabIndex = 0;
  const click = (e: Event) => {
    e.stopPropagation();
    onClick();
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") click(e);
  };
  el.addEventListener("click", click);
  el.addEventListener("keydown", key);
  return () => {
    el.classList.remove(...classes);
    el.removeEventListener("click", click);
    el.removeEventListener("keydown", key);
  };
}
