import { nearestStation, type SnotelDepth } from "@/lib/snotel";

/** The nearest SNOTEL's depth for a list row, or nothing when there's no station near. */
export function SnowDepthTag({
  depths,
  lat,
  lon,
  elevationFt,
}: {
  depths: SnotelDepth[];
  lat: number;
  lon: number;
  elevationFt: number | null;
}) {
  const near = nearestStation(depths, lat, lon, elevationFt);
  if (!near) return null;
  const { station, miles } = near;
  return (
    <span
      className="shrink-0 text-right leading-tight"
      title={`Snow depth at ${station.name} SNOTEL, ${station.elevationFt.toLocaleString()} ft, ${miles.toFixed(1)} mi away`}
    >
      <span className="block text-sm font-semibold tabular-nums">{Math.round(station.depthIn)}″</span>
      <span className="block text-[11px] text-muted-dim">depth</span>
    </span>
  );
}
