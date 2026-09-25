"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";

/**
 * The map lives in the root layout, not in the `/` page.
 *
 * Next 16 keeps recently visited pages alive in React `<Activity>` and runs
 * their effect cleanup when you navigate away — which for react-leaflet means
 * destroying the map, its tiles and every radar frame, then rebuilding it all
 * on the way back. Hosting it here keeps one map for the life of the tab: it
 * is only hidden while another page is showing, so position, zoom and cached
 * tiles survive a trip to the Reports list and back.
 *
 * Leaflet touches `window` on import, so it is loaded client-side only.
 *
 * `z-[1]` rather than `z-0`: the layout's `<main>` comes later in the tree and
 * fills the same space, so at z-index 0 it would sit on top of the map — empty
 * on this route, but still catching every click, drag and scroll. While the map
 * is hidden it is also `pointer-events-none`, so being on top costs nothing.
 */
const StormMap = dynamic(() => import("./StormMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted-dim">Loading map…</div>
  ),
});

export function MapHost() {
  const active = usePathname() === "/";
  return (
    <div
      aria-hidden={!active}
      className={`fixed inset-x-0 z-[1] ${active ? "" : "invisible pointer-events-none"}`}
      style={{ top: "var(--header-h)", bottom: "var(--tabbar-h)" }}
    >
      <StormMap active={active} />
    </div>
  );
}
