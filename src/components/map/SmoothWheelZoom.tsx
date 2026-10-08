"use client";

import type { LatLng, Map as LeafletMap, Point } from "leaflet";
import { useEffect } from "react";
import { useMap } from "react-leaflet";

/**
 * Continuous zoom for trackpads and mouse wheels, in place of Leaflet's
 * scroll-wheel handler.
 *
 * Leaflet turns each burst of wheel events into a separate 250 ms zoom
 * animation and drops whatever arrives while one is running. A trackpad sends
 * a steady stream, so most of a gesture was thrown away. Here every event
 * moves a target zoom and the map eases toward it frame by frame, scaling the
 * tiles it has; new tiles load once the gesture ends. This is the same path
 * Leaflet's own touch pinch takes.
 */

/** Two-finger scroll or mouse wheel: pixels of scroll per zoom level. */
const SCROLL_PX_PER_LEVEL = 180;
/**
 * Trackpad pinch. Chrome, Edge and Firefox report it as a ctrl+wheel whose
 * deltaY is about -100·ln(scale), so this keeps the map under the fingers.
 */
const PINCH_PX_PER_LEVEL = 100 * Math.LN2;
/** The most one wheel event may move, so a coarse mouse wheel can't lurch. */
const MAX_LEVELS_PER_EVENT = 1;
/** Fraction of the remaining distance covered each frame. */
const EASE = 0.4;
/** No input for this long and the gesture is over. */
const IDLE_MS = 150;

/** Leaflet internals its pinch handler uses; not in the public types. */
interface MoveHooks {
  _animatingZoom?: boolean;
  _moveStart(zoomChanged: boolean, noMoveStart: boolean): unknown;
  _move(center: LatLng, zoom: number, data?: { pinch?: boolean }): unknown;
  _moveEnd(zoomChanged: boolean): unknown;
}

/** Safari reports a trackpad pinch as gesture events, not wheel events. */
interface GestureEvent extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}

export function SmoothWheelZoom() {
  const map = useMap();

  useEffect(() => {
    const m = map as LeafletMap & MoveHooks;
    const el = map.getContainer();

    let goal: number | null = null;
    let at: Point = map.getSize().divideBy(2);
    let moving = false;
    let inputDone = false;
    let frame = 0;
    let idle = 0;
    let gestureFrom: number | null = null;

    const clamp = (z: number) => Math.min(map.getMaxZoom(), Math.max(map.getMinZoom(), z));

    const end = () => {
      goal = null;
      if (!moving) return;
      moving = false;
      // A plain `zoom` (not flagged as a pinch) is what makes tile layers
      // switch to the level for the new zoom and fetch its tiles.
      map.fire("zoom");
      m._moveEnd(true);
    };

    const step = () => {
      frame = 0;
      if (goal === null) return;
      if (m._animatingZoom) {
        // A button or keyboard zoom is mid-animation; join in after it.
        frame = requestAnimationFrame(step);
        return;
      }
      const zoom = map.getZoom();
      const next = Math.abs(goal - zoom) < 0.002 ? goal : zoom + (goal - zoom) * EASE;
      if (next !== zoom) {
        if (!moving) {
          m._moveStart(true, false);
          moving = true;
        }
        // Keep the point under the pointer fixed while the scale changes.
        const under = map.containerPointToLatLng(at);
        const offset = at.subtract(map.getSize().divideBy(2));
        m._move(map.unproject(map.project(under, next).subtract(offset), next), next, { pinch: true });
      }
      if (next !== goal) frame = requestAnimationFrame(step);
      else if (inputDone) end();
    };

    const zoomTo = (target: number, point: Point) => {
      goal = clamp(target);
      at = point;
      inputDone = false;
      window.clearTimeout(idle);
      idle = window.setTimeout(() => {
        inputDone = gestureFrom === null;
        if (inputDone && !frame) step();
      }, IDLE_MS);
      if (!frame) frame = requestAnimationFrame(step);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Safari can send ctrl+wheel alongside its gesture events; count a pinch once.
      if (gestureFrom !== null) return;
      const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * el.clientHeight : e.deltaY;
      const levels = -px / (e.ctrlKey ? PINCH_PX_PER_LEVEL : SCROLL_PX_PER_LEVEL);
      const capped = Math.max(-MAX_LEVELS_PER_EVENT, Math.min(MAX_LEVELS_PER_EVENT, levels));
      zoomTo((goal ?? map.getZoom()) + capped, map.mouseEventToContainerPoint(e));
    };

    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureFrom = goal ?? map.getZoom();
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as GestureEvent;
      if (gestureFrom === null || !(g.scale > 0)) return;
      zoomTo(gestureFrom + Math.log2(g.scale), map.mouseEventToContainerPoint(g as unknown as MouseEvent));
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      gestureFrom = null;
      if (goal !== null) zoomTo(goal, at);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart);
    el.addEventListener("gesturechange", onGestureChange);
    el.addEventListener("gestureend", onGestureEnd);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
      el.removeEventListener("gestureend", onGestureEnd);
      cancelAnimationFrame(frame);
      window.clearTimeout(idle);
    };
  }, [map]);

  return null;
}
