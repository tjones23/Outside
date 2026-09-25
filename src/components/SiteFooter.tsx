"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Attribution on every page except the map, which carries its own. */
export function SiteFooter() {
  if (usePathname() === "/") return null;
  return (
    <footer className="border-t border-line-soft">
      <div className="mx-auto max-w-5xl space-y-2 px-4 py-8 pb-tabbar text-xs leading-relaxed text-muted-dim sm:px-6 sm:pb-8">
        <p>
          Warnings from the National Weather Service. Storm reports and outlooks from NOAA&apos;s Storm
          Prediction Center. Radar by RainViewer. Map tiles © Esri, HERE, Garmin and OpenStreetMap contributors. Place search
          by OpenStreetMap Nominatim.
        </p>
        <p>
          Not an official warning source — for life-safety decisions, rely on NOAA Weather Radio, Wireless
          Emergency Alerts and your local officials.{" "}
          <Link href="/about" className="underline underline-offset-2 hover:text-text">
            About Outside
          </Link>
        </p>
      </div>
    </footer>
  );
}
