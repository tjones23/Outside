"use client";

import { useState } from "react";
import { savedLocationStatus, type LocationStatus } from "@/lib/nearby";
import { midFt, type Resort } from "@/lib/resorts";
import type { SnotelDepth } from "@/lib/snotel";
import type { LatLng, SavedLocation, StormAlert, StormReport } from "@/lib/types";
import { PassBadge } from "./PassBadge";
import { SnowDepthTag } from "./SnowDepthTag";
import type { LocationState } from "./providers/LocationProvider";
import { Button, EmptyState } from "./ui/controls";

function StatusLine({ status }: { status: LocationStatus }) {
  return (
    <span
      className={`block text-sm ${status.tone === "reports" ? "text-watch" : status.tone === "quiet" ? "text-muted-dim" : ""}`}
      style={status.color ? { color: status.color } : undefined}
    >
      {status.label}
    </span>
  );
}

const ARROW = "rounded-full px-2.5 py-1 text-sm text-muted hover:bg-surface-2 hover:text-text disabled:opacity-30 disabled:hover:bg-transparent";

/**
 * Where you are, pinned on top, then saved places in the order you've put
 * them, each with a one-line storm status and the nearest measured snow depth.
 */
export function FavoritesList({
  locations,
  here,
  location,
  alerts,
  reports,
  resortsById,
  depths,
  onOpen,
  onMove,
}: {
  locations: SavedLocation[];
  here: LatLng | null;
  location: LocationState;
  alerts: StormAlert[];
  reports: StormReport[];
  resortsById: Map<string, Resort>;
  depths: SnotelDepth[];
  /** A saved place's id, or "here". */
  onOpen: (target: string) => void;
  onMove: (id: string, delta: -1 | 1) => void;
}) {
  const [reordering, setReordering] = useState(false);

  return (
    <>
      <ul className="divide-y divide-line-soft overflow-hidden rounded-2xl border border-line bg-surface">
        <li>
          {here ? (
            <button
              type="button"
              onClick={() => onOpen("here")}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2"
            >
              <span className="text-accent" aria-hidden="true">
                ◉
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">Where you are</span>
                <StatusLine status={savedLocationStatus({ lat: here[0], lon: here[1] }, alerts, reports)} />
              </span>
              <SnowDepthTag depths={depths} lat={here[0]} lon={here[1]} elevationFt={null} />
              <span className="text-muted-dim" aria-hidden="true">
                ›
              </span>
            </button>
          ) : (
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="text-muted-dim" aria-hidden="true">
                ◎
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">Where you are</span>
                <span className="block text-sm text-muted-dim">
                  {!location.available
                    ? "Needs the HTTPS address."
                    : (location.error ?? "Share your location to see the weather where you are.")}
                </span>
              </span>
              {location.available && (
                <Button onClick={() => void location.request()} disabled={location.busy} className="px-3 py-1">
                  {location.busy ? "Locating…" : "Locate"}
                </Button>
              )}
            </div>
          )}
        </li>

        {locations.map((loc, i) => {
          const resort = loc.resortId ? resortsById.get(loc.resortId) : undefined;
          const status = savedLocationStatus(loc, alerts, reports);
          const content = (
            <>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate font-medium">{loc.name}</span>
                  {resort && <PassBadge pass={resort.pass} />}
                </span>
                <StatusLine status={status} />
              </span>
              <SnowDepthTag depths={depths} lat={loc.lat} lon={loc.lon} elevationFt={resort ? midFt(resort) : null} />
            </>
          );
          return (
            <li key={loc.id}>
              {reordering ? (
                <div className="flex items-center gap-3 px-4 py-3">
                  {content}
                  <span className="flex shrink-0">
                    <button
                      type="button"
                      className={ARROW}
                      disabled={i === 0}
                      onClick={() => onMove(loc.id, -1)}
                      aria-label={`Move ${loc.name} up`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className={ARROW}
                      disabled={i === locations.length - 1}
                      onClick={() => onMove(loc.id, 1)}
                      aria-label={`Move ${loc.name} down`}
                    >
                      ↓
                    </button>
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onOpen(loc.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2"
                >
                  {content}
                  <span className="text-muted-dim" aria-hidden="true">
                    ›
                  </span>
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {locations.length === 0 ? (
        <div className="mt-4">
          <EmptyState title="No saved places">
            Save home, work or a ski resort to see at a glance when a warning covers them, storms were reported
            nearby, or snow is on the way. Star a resort in Ski resorts to add it here.
          </EmptyState>
        </div>
      ) : (
        locations.length > 1 && (
          <div className="mt-3 flex justify-end">
            <Button variant="ghost" onClick={() => setReordering((r) => !r)} className="px-3 py-1">
              {reordering ? "Done" : "Reorder"}
            </Button>
          </div>
        )
      )}
    </>
  );
}
