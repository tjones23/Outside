"use client";

import { useMemo, useState } from "react";
import { useResortPrefs } from "@/lib/client-store";
import { formatMiles } from "@/lib/format";
import {
  midFt,
  moveInOrder,
  PASS_LABEL,
  queryResorts,
  SKI_PASSES,
  stateAt,
  type Resort,
  type ResortSort,
} from "@/lib/resorts";
import { SNOTEL_RADIUS_MILES, type SnotelDepth } from "@/lib/snotel";
import type { LatLng } from "@/lib/types";
import { stateName } from "@/lib/us-states";
import { PassBadge } from "./PassBadge";
import { SnowDepthTag } from "./SnowDepthTag";
import type { LocationState } from "./providers/LocationProvider";
import type { ResortData } from "./providers/useResortData";
import { Button, Chip, EmptyState, ErrorNote, Segmented } from "./ui/controls";

const ARROW = "rounded-full px-2.5 py-1 text-sm text-muted hover:bg-surface-2 hover:text-text disabled:opacity-30 disabled:hover:bg-transparent";

/**
 * The ski resorts in the state you're in (or one you pick), nearest first or
 * in your own order, filtered by name and pass. Starring one adds it to
 * favorites.
 */
export function ResortList({
  data,
  here,
  location,
  depths,
  depthsError,
  favorites,
  onOpen,
  onToggleFavorite,
}: {
  data: ResortData | null | undefined;
  here: LatLng | null;
  location: LocationState;
  depths: SnotelDepth[];
  depthsError: string | null;
  /** Saved place id by resort id. */
  favorites: Map<string, string>;
  onOpen: (resortId: string) => void;
  onToggleFavorite: (resort: Resort) => void;
}) {
  const { prefs, update, setOrder } = useResortPrefs();
  const [search, setSearch] = useState("");
  const [reordering, setReordering] = useState(false);

  const hereState = useMemo(() => (data && here ? stateAt(data.states, here) : null), [data, here]);
  const state = prefs.state ?? hereState;
  const statesWithResorts = useMemo(
    () =>
      [...new Set((data?.resorts ?? []).flatMap((r) => r.states))].sort((a, b) => stateName(a).localeCompare(stateName(b))),
    [data],
  );

  const rows = useMemo(
    () =>
      data && state
        ? queryResorts(data.resorts, {
            state,
            // Reordering works on the whole list, so nothing hidden is left out of place.
            search: reordering ? "" : search,
            passes: reordering ? [] : prefs.passes,
            sort: prefs.sort,
            order: prefs.order[state] ?? [],
            from: here,
          })
        : [],
    [data, state, search, prefs, here, reordering],
  );

  if (data === undefined) return <p className="py-3 text-sm text-muted-dim">Loading resorts…</p>;
  if (data === null) return <ErrorNote>Couldn&rsquo;t load the resort list. Try reloading the page.</ErrorNote>;

  const togglePass = (pass: (typeof SKI_PASSES)[number]) =>
    update({ passes: prefs.passes.includes(pass) ? prefs.passes.filter((p) => p !== pass) : [...prefs.passes, pass] });

  return (
    <>
      <div className="mb-3 space-y-2">
        <div className="flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="resort-state">
            State
          </label>
          <select
            id="resort-state"
            value={prefs.state ?? ""}
            onChange={(e) => {
              setReordering(false);
              update({ state: e.target.value || null });
            }}
            className="rounded-full border border-line bg-surface-2 px-3 py-2 text-sm text-text focus:border-accent/60 focus:outline-none"
          >
            <option value="">{hereState ? `Where I am (${stateName(hereState)})` : "Where I am"}</option>
            {statesWithResorts.map((code) => (
              <option key={code} value={code}>
                {stateName(code)}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="resort-search">
            Find a resort
          </label>
          <input
            id="resort-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={reordering}
            placeholder="Find a resort"
            className="min-w-0 flex-1 rounded-full border border-line bg-surface-2 px-4 py-2 text-sm text-text placeholder:text-muted-dim focus:border-accent/60 focus:outline-none disabled:opacity-50"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {SKI_PASSES.map((pass) => (
            <Chip key={pass} on={prefs.passes.includes(pass)} onClick={() => togglePass(pass)}>
              {PASS_LABEL[pass]}
            </Chip>
          ))}
          <div className="ml-auto w-48">
            <Segmented<ResortSort>
              label="Sort resorts"
              value={prefs.sort}
              onChange={(sort) => {
                setReordering(false);
                update({ sort });
              }}
              options={[
                { value: "distance", label: "Nearest" },
                { value: "custom", label: "My order" },
              ]}
            />
          </div>
        </div>
      </div>

      {!state ? (
        <EmptyState title="Which state?">
          <p>Share your location to list the resorts in your state, or pick one above.</p>
          {location.available && (
            <div className="mt-3">
              <Button onClick={() => void location.request()} disabled={location.busy}>
                {location.busy ? "Locating…" : "Use my location"}
              </Button>
            </div>
          )}
          {location.error && <p className="mt-2 text-xs text-danger">{location.error}</p>}
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState title="No resorts match">
          {search || prefs.passes.length > 0
            ? "Try another name, or turn a pass filter off."
            : `No lift-served ski areas in ${stateName(state)}.`}
        </EmptyState>
      ) : (
        <>
          {prefs.sort === "distance" && !here && (
            <p className="mb-2 text-xs text-muted-dim">A to Z — share your location to sort nearest first.</p>
          )}
          <ul className="divide-y divide-line-soft overflow-hidden rounded-2xl border border-line bg-surface">
            {rows.map(({ resort, miles }, i) => {
              const starred = favorites.has(resort.id);
              return (
                <li key={resort.id} className="flex items-center">
                  <button
                    type="button"
                    onClick={() => onToggleFavorite(resort)}
                    aria-pressed={starred}
                    aria-label={starred ? `Remove ${resort.name} from favorites` : `Add ${resort.name} to favorites`}
                    className={`shrink-0 py-3 pl-4 pr-1 text-lg leading-none ${starred ? "text-accent" : "text-muted-dim hover:text-text"}`}
                  >
                    {starred ? "★" : "☆"}
                  </button>
                  <ResortRowBody
                    resort={resort}
                    miles={miles}
                    depths={depths}
                    reordering={reordering}
                    onOpen={() => onOpen(resort.id)}
                  />
                  {reordering && (
                    <span className="flex shrink-0 pr-3">
                      <button
                        type="button"
                        className={ARROW}
                        disabled={i === 0}
                        onClick={() => setOrder(state, moveInOrder(rows.map((r) => r.resort.id), resort.id, -1))}
                        aria-label={`Move ${resort.name} up`}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className={ARROW}
                        disabled={i === rows.length - 1}
                        onClick={() => setOrder(state, moveInOrder(rows.map((r) => r.resort.id), resort.id, 1))}
                        aria-label={`Move ${resort.name} down`}
                      >
                        ↓
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {prefs.sort === "custom" && (
            <div className="mt-3 flex justify-end gap-2">
              {reordering && (prefs.order[state]?.length ?? 0) > 0 && (
                <Button variant="ghost" onClick={() => setOrder(state, [])} className="px-3 py-1">
                  Reset to nearest
                </Button>
              )}
              <Button variant="ghost" onClick={() => setReordering((r) => !r)} className="px-3 py-1">
                {reordering ? "Done" : "Reorder"}
              </Button>
            </div>
          )}
        </>
      )}

      <p className="mt-4 text-xs text-muted-dim">
        Lift-served ski areas from{" "}
        <a href="https://openskimap.org/" target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">
          OpenSkiMap
        </a>{" "}
        (© OpenStreetMap contributors). Epic and Ikon as listed for {data.season}, Ikon&rsquo;s bonus mountains
        included; check the pass for days and blackouts. Depth is measured at the nearest USDA SNOTEL station within{" "}
        {SNOTEL_RADIUS_MILES} miles, not the resort&rsquo;s own report, which isn&rsquo;t published openly.
        {depthsError && ` Snow depths couldn’t load: ${depthsError}`}
      </p>
    </>
  );
}

function ResortRowBody({
  resort,
  miles,
  depths,
  reordering,
  onOpen,
}: {
  resort: Resort;
  miles: number | null;
  depths: SnotelDepth[];
  reordering: boolean;
  onOpen: () => void;
}) {
  const content = (
    <>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{resort.name}</span>
          <PassBadge pass={resort.pass} />
        </span>
        <span className="block text-sm text-muted-dim">
          {[
            miles !== null ? formatMiles(miles) : null,
            resort.topFt !== null ? `top ${resort.topFt.toLocaleString()} ft` : null,
          ]
            .filter(Boolean)
            .join(" · ") || " "}
        </span>
      </span>
      <SnowDepthTag depths={depths} lat={resort.lat} lon={resort.lon} elevationFt={midFt(resort)} />
    </>
  );
  if (reordering) return <div className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-2 pr-1">{content}</div>;
  return (
    <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-2 pr-4 text-left hover:bg-surface-2">
      {content}
      <span className="text-muted-dim" aria-hidden="true">
        ›
      </span>
    </button>
  );
}
