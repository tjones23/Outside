"use client";

import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useHydrated, usePlacesView, useSavedLocations, type PlacesView } from "@/lib/client-store";
import { relinkFavorites, type Resort } from "@/lib/resorts";
import type { SnotelDepth } from "@/lib/snotel";
import type { LatLng, SnowDepths } from "@/lib/types";
import { AddLocationForm } from "./AddLocationForm";
import { FavoritesList } from "./FavoritesList";
import { PageHeader } from "./PageHeader";
import { PlaceSheet, type PlacePoint } from "./PlaceSheet";
import { ResortList } from "./ResortList";
import { useLocation } from "./providers/LocationProvider";
import { useFilteredData } from "./providers/useFilteredData";
import { usePoll } from "./providers/usePoll";
import { useResortData } from "./providers/useResortData";
import { tabId, tabPanelId, Tabs } from "./ui/Tabs";
import { Button } from "./ui/controls";

const MINUTE = 60 * 1000;
const EMPTY_DEPTHS: SnotelDepth[] = [];

type Open = { kind: "saved"; id: string } | { kind: "here" } | { kind: "resort"; id: string };

/**
 * Where you are, rounded to about half a mile: close enough for weather, and
 * it keeps the forecasts from refetching every time the phone moves a few
 * steps.
 */
function roundHere(coord: LatLng | null): LatLng | null {
  return coord && [Math.round(coord[0] * 100) / 100, Math.round(coord[1] * 100) / 100];
}

/** The Places page: favorites (where you are and saved places) and the ski resorts in your state. */
export function Places() {
  const { view, setView } = usePlacesView();
  const hydrated = useHydrated();
  const { locations, add, remove, move, relink } = useSavedLocations();
  const { allAlerts, reports } = useFilteredData();
  const location = useLocation();
  const here = roundHere(location.coord);
  const ids = useId();

  const needResorts = view === "resorts" || locations.some((l) => l.resortId);
  const data = useResortData(hydrated && needResorts);
  const resortsById = useMemo(() => new Map((data?.resorts ?? []).map((r) => [r.id, r])), [data]);

  // A favorite saved under a resort id the data no longer has gets the resort's new one.
  useEffect(() => {
    if (!data) return;
    const moves = relinkFavorites(locations, data.resorts);
    if (moves.size > 0) relink(moves);
  }, [data, locations, relink]);
  const depthsFeed = usePoll<SnowDepths>(hydrated ? "/api/snow-depth" : null, 30 * MINUTE, {
    whenHidden: false,
    refreshToken: 0,
  });
  const depths = depthsFeed.data?.stations ?? EMPTY_DEPTHS;

  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<Open | null>(null);
  const close = useCallback(() => setOpen(null), []);

  /** Saved place id by resort id, for the stars. */
  const favoriteOf = useMemo(
    () => new Map(locations.flatMap((l) => (l.resortId ? [[l.resortId, l.id] as const] : []))),
    [locations],
  );
  const toggleFavorite = useCallback(
    (resort: Resort) => {
      const saved = favoriteOf.get(resort.id);
      if (saved) remove(saved);
      else add(resort.name, resort.lat, resort.lon, resort.id);
    },
    [favoriteOf, add, remove],
  );

  let sheet: { place: PlacePoint; resort: Resort | null; actions?: ReactNode } | null = null;
  if (open?.kind === "saved") {
    const saved = locations.find((l) => l.id === open.id);
    if (saved) {
      sheet = {
        place: saved,
        resort: saved.resortId ? (resortsById.get(saved.resortId) ?? null) : null,
        actions: (
          <Button
            variant="danger"
            onClick={() => {
              remove(saved.id);
              setOpen(null);
            }}
            className="px-3 py-1"
          >
            Remove
          </Button>
        ),
      };
    }
  } else if (open?.kind === "here" && here) {
    sheet = { place: { name: "Where you are", lat: here[0], lon: here[1] }, resort: null };
  } else if (open?.kind === "resort") {
    const resort = resortsById.get(open.id);
    if (resort) {
      const saved = favoriteOf.has(resort.id);
      sheet = {
        place: resort,
        resort,
        actions: (
          <Button onClick={() => toggleFavorite(resort)} className="px-3 py-1" title={saved ? "Remove from favorites" : "Add to favorites"}>
            <span aria-hidden="true">{saved ? "★" : "☆"}</span>
            {saved ? "Favorite" : "Add to favorites"}
          </Button>
        ),
      };
    }
  }

  return (
    <>
      <PageHeader
        title="Places"
        subtitle="Favorites are saved in this browser only, and used for the “saved place” notification. Open one for its 7-day forecast, recent snow and 15-day snow blend."
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            Add place
          </Button>
        }
      />

      <Tabs<PlacesView>
        label="Places"
        idPrefix={ids}
        value={view}
        onChange={setView}
        tabs={[
          { value: "favorites", label: "Favorites" },
          { value: "resorts", label: "Ski resorts" },
        ]}
        className="mb-4 rounded-full border border-line bg-surface p-1"
      />

      <div role="tabpanel" id={tabPanelId(ids, "favorites")} aria-labelledby={tabId(ids, "favorites")} hidden={view !== "favorites"}>
        {hydrated && view === "favorites" && (
          <FavoritesList
            locations={locations}
            here={here}
            location={location}
            alerts={allAlerts}
            reports={reports}
            resortsById={resortsById}
            depths={depths}
            onOpen={(target) => setOpen(target === "here" ? { kind: "here" } : { kind: "saved", id: target })}
            onMove={move}
          />
        )}
      </div>
      <div role="tabpanel" id={tabPanelId(ids, "resorts")} aria-labelledby={tabId(ids, "resorts")} hidden={view !== "resorts"}>
        {hydrated && view === "resorts" && (
          <ResortList
            data={data}
            here={here}
            location={location}
            depths={depths}
            depthsError={depthsFeed.error}
            favorites={favoriteOf}
            onOpen={(id) => setOpen({ kind: "resort", id })}
            onToggleFavorite={toggleFavorite}
          />
        )}
      </div>

      {adding && <AddLocationForm onClose={() => setAdding(false)} />}
      {sheet && (
        <PlaceSheet
          key={open?.kind === "here" ? "here" : open?.id}
          place={sheet.place}
          resort={sheet.resort}
          alerts={allAlerts}
          reports={reports}
          actions={sheet.actions}
          onClose={close}
        />
      )}
    </>
  );
}
