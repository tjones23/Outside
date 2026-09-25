"use client";

import { useState, type FormEvent } from "react";
import { useSavedLocations } from "@/lib/client-store";
import type { GeocodeResult } from "@/lib/types";
import { useLocation } from "./providers/LocationProvider";
import { Sheet } from "./ui/Sheet";
import { Button, ErrorNote } from "./ui/controls";

/**
 * Save a place by searching for it, or from where you are now.
 *
 * Search runs only when the form is submitted — never as you type — which
 * is what OpenStreetMap's Nominatim asks of every client.
 */
export function AddLocationForm({ onClose }: { onClose: () => void }) {
  const { add } = useSavedLocations();
  const location = useLocation();
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ lat: number; lon: number; name: string } | null>(null);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = String(new FormData(event.currentTarget).get("q") ?? "").trim();
    if (!q) return;
    setSearching(true);
    setError(null);
    try {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
      const body = (await response.json()) as { results?: GeocodeResult[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Search failed.");
      setResults(body.results ?? []);
    } catch (e) {
      setError(e instanceof TypeError ? "Can't reach the Outside server." : (e as Error).message);
    } finally {
      setSearching(false);
    }
  }

  async function saveCurrent() {
    const fix = await location.request();
    if (fix) setPending({ lat: fix[0], lon: fix[1], name: "Current location" });
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending) return;
    const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    add(name || pending.name, pending.lat, pending.lon);
    onClose();
  }

  return (
    <Sheet title="Add a place" onClose={onClose}>
      {pending ? (
        <form onSubmit={save} className="space-y-4">
          <p className="text-sm text-muted">
            {pending.lat.toFixed(3)}, {pending.lon.toFixed(3)}
          </p>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Name</span>
            <input
              name="name"
              defaultValue={pending.name}
              autoFocus
              maxLength={60}
              className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-text focus:border-accent/60 focus:outline-none"
            />
          </label>
          <div className="flex gap-2">
            <Button type="submit" variant="primary">
              Save place
            </Button>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Back
            </Button>
          </div>
        </form>
      ) : (
        <>
          <form onSubmit={search} role="search" className="flex gap-2">
            <label htmlFor="place-search" className="sr-only">
              City, ZIP code or address
            </label>
            <input
              id="place-search"
              name="q"
              type="search"
              autoFocus
              placeholder="City, ZIP code or address"
              className="min-w-0 flex-1 rounded-full border border-line bg-surface-2 px-4 py-2 text-sm text-text placeholder:text-muted-dim focus:border-accent/60 focus:outline-none"
            />
            <Button type="submit" variant="primary" disabled={searching}>
              {searching ? "Searching…" : "Search"}
            </Button>
          </form>

          {error && (
            <div className="mt-3">
              <ErrorNote>{error}</ErrorNote>
            </div>
          )}

          {results && (
            <ul className="mt-3 divide-y divide-line-soft overflow-hidden rounded-xl border border-line">
              {results.length === 0 && <li className="px-4 py-3 text-sm text-muted">No US places match.</li>}
              {results.map((r) => (
                <li key={`${r.lat},${r.lon},${r.detail}`}>
                  <button
                    type="button"
                    onClick={() => setPending({ lat: r.lat, lon: r.lon, name: r.name })}
                    className="block w-full px-4 py-2.5 text-left hover:bg-surface-2"
                  >
                    <span className="block text-sm">{r.name}</span>
                    <span className="block truncate text-xs text-muted-dim">{r.detail}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {results && results.length > 0 && (
            <p className="mt-2 text-[11px] text-muted-dim">Search by OpenStreetMap Nominatim · © OpenStreetMap contributors</p>
          )}

          <div className="mt-5 border-t border-line-soft pt-4">
            <Button onClick={() => void saveCurrent()} disabled={!location.available || location.busy}>
              {location.busy ? "Locating…" : "Use my current location"}
            </Button>
            {!location.available && (
              <p className="mt-2 text-xs text-muted-dim">Current location needs the HTTPS address; search works everywhere.</p>
            )}
            {location.error && location.available && <p className="mt-2 text-xs text-danger">{location.error}</p>}
          </div>
        </>
      )}
    </Sheet>
  );
}
