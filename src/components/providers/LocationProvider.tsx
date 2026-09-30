"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { LatLng } from "@/lib/types";
import { useSecureContext } from "./useSecureContext";

/**
 * The viewer's location, asked for only when they ask for something that
 * needs it (the locate button, "nearest first", "use my location") — unless
 * they already granted it before, in which case it's picked up on load so
 * the "near you" banner can show straight away.
 *
 * Once there's a first fix, the position is watched so the map's marker and
 * the "near you" banner follow the viewer as they move.
 */

interface LocationState {
  coord: LatLng | null;
  /** Radius of the fix's uncertainty, in meters. */
  accuracy: number | null;
  error: string | null;
  busy: boolean;
  /** Geolocation exists here at all (it doesn't on the plain-HTTP address). */
  available: boolean;
  request: () => Promise<LatLng | null>;
}

interface Fix {
  coord: LatLng;
  accuracy: number;
}

const LocationContext = createContext<LocationState | null>(null);

const OPTIONS: PositionOptions = { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 };

function toFix(p: GeolocationPosition): Fix {
  return { coord: [p.coords.latitude, p.coords.longitude], accuracy: p.coords.accuracy };
}

function locate(): Promise<Fix> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition((p) => resolve(toFix(p)), reject, OPTIONS);
  });
}

function describe(error: unknown): string {
  const code = (error as GeolocationPositionError)?.code;
  if (code === 1) return "Location permission was denied.";
  if (code === 3) return "Finding your location timed out.";
  return "Couldn't determine your location.";
}

/** Keeps the previous fix when nothing changed, so consumers don't re-sort. */
function sameFix(a: Fix | null, b: Fix): boolean {
  return !!a && a.coord[0] === b.coord[0] && a.coord[1] === b.coord[1] && a.accuracy === b.accuracy;
}

export function LocationProvider({ children }: { children: ReactNode }) {
  const secure = useSecureContext();
  const [fix, setFix] = useState<Fix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const available = secure && typeof navigator !== "undefined" && "geolocation" in navigator;
  const update = useCallback((next: Fix) => setFix((prev) => (sameFix(prev, next) ? prev : next)), []);

  const request = useCallback(async (): Promise<LatLng | null> => {
    if (!window.isSecureContext || !("geolocation" in navigator)) {
      setError("Location needs the HTTPS address.");
      return null;
    }
    setBusy(true);
    try {
      const next = await locate();
      update(next);
      setError(null);
      return next.coord;
    } catch (e) {
      setError(describe(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, [update]);

  // Already granted on an earlier visit? Then don't make them ask again.
  useEffect(() => {
    if (!window.isSecureContext || !navigator.permissions) return;
    let cancelled = false;
    navigator.permissions
      .query({ name: "geolocation" })
      .then((status) => {
        if (!cancelled && status.state === "granted") return locate().then((next) => {
          if (!cancelled) update(next);
        });
      })
      .catch(() => {
        // Permissions API missing or location failed; stay quiet until asked.
      });
    return () => {
      cancelled = true;
    };
  }, [update]);

  // Follow the viewer once they've shared a location at all.
  const tracking = fix !== null;
  useEffect(() => {
    if (!tracking) return;
    const id = navigator.geolocation.watchPosition(
      (p) => update(toFix(p)),
      (e) => {
        // Permission revoked: forget where they were. A timeout or a lost
        // signal just leaves the last known position up.
        if (e.code === e.PERMISSION_DENIED) {
          setFix(null);
          setError(describe(e));
        }
      },
      { ...OPTIONS, timeout: Infinity },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [tracking, update]);

  const coord = fix?.coord ?? null;
  const accuracy = fix?.accuracy ?? null;
  const value = useMemo(
    () => ({ coord, accuracy, error, busy, available, request }),
    [coord, accuracy, error, busy, available, request],
  );
  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useLocation(): LocationState {
  const value = useContext(LocationContext);
  if (!value) throw new Error("useLocation must be used inside <LocationProvider>");
  return value;
}
