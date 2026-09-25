"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { LatLng } from "@/lib/types";
import { useSecureContext } from "./useSecureContext";

/**
 * The viewer's location, asked for only when they ask for something that
 * needs it (the locate button, "nearest first", "use my location") — unless
 * they already granted it before, in which case it's picked up on load so
 * the "near you" banner can show straight away.
 */

interface LocationState {
  coord: LatLng | null;
  error: string | null;
  busy: boolean;
  /** Geolocation exists here at all (it doesn't on the plain-HTTP address). */
  available: boolean;
  request: () => Promise<LatLng | null>;
}

const LocationContext = createContext<LocationState | null>(null);

function locate(): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve([p.coords.latitude, p.coords.longitude]),
      (e) => reject(e),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  });
}

function describe(error: unknown): string {
  const code = (error as GeolocationPositionError)?.code;
  if (code === 1) return "Location permission was denied.";
  if (code === 3) return "Finding your location timed out.";
  return "Couldn't determine your location.";
}

export function LocationProvider({ children }: { children: ReactNode }) {
  const secure = useSecureContext();
  const [coord, setCoord] = useState<LatLng | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const available = secure && typeof navigator !== "undefined" && "geolocation" in navigator;

  const request = useCallback(async (): Promise<LatLng | null> => {
    if (!window.isSecureContext || !("geolocation" in navigator)) {
      setError("Location needs the HTTPS address.");
      return null;
    }
    setBusy(true);
    try {
      const fix = await locate();
      setCoord(fix);
      setError(null);
      return fix;
    } catch (e) {
      setError(describe(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  // Already granted on an earlier visit? Then don't make them ask again.
  useEffect(() => {
    if (!window.isSecureContext || !navigator.permissions) return;
    let cancelled = false;
    navigator.permissions
      .query({ name: "geolocation" })
      .then((status) => {
        if (!cancelled && status.state === "granted") return locate().then((fix) => {
          if (!cancelled) setCoord(fix);
        });
      })
      .catch(() => {
        // Permissions API missing or location failed; stay quiet until asked.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({ coord, error, busy, available, request }),
    [coord, error, busy, available, request],
  );
  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useLocation(): LocationState {
  const value = useContext(LocationContext);
  if (!value) throw new Error("useLocation must be used inside <LocationProvider>");
  return value;
}
