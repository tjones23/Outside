"use client";

import { useFilters } from "@/lib/client-store";
import { HAIL_MAX, HAIL_STEP, REPORT_DAY_OPTIONS, WIND_MAX, WIND_MIN } from "@/lib/filters";
import { availableDays, clampDay, OUTLOOK_KINDS, outlookKindTitle } from "@/lib/outlook";
import type { OutlookKind } from "@/lib/types";
import { AlertKindChips, CategoryChips } from "./FilterChips";
import { Sheet } from "./ui/Sheet";
import { Button, Chip, SectionTitle, Switch } from "./ui/controls";

/**
 * Everything that decides what the map and lists show. Same options, ranges
 * and snapping as the mobile filter screen — without its quirk of turning a
 * "no minimum" wind filter into 60 mph just by opening it.
 */
export function FiltersPanel({ onClose }: { onClose: () => void }) {
  const { filters: f, update, reset } = useFilters();

  const selectKind = (kind: OutlookKind | null) =>
    update({ outlookKind: kind, outlookDay: kind ? clampDay(kind, f.outlookDay) : f.outlookDay });

  return (
    <Sheet
      title="Filters"
      onClose={onClose}
      actions={
        <Button variant="ghost" onClick={reset} className="px-3 py-1">
          Reset
        </Button>
      }
    >
      <SectionTitle>Storm types</SectionTitle>
      <CategoryChips />

      <SectionTitle>Alerts</SectionTitle>
      <AlertKindChips />

      <SectionTitle>Minimum magnitude</SectionTitle>
      <Slider
        label="Wind"
        value={f.minWindMph}
        display={f.minWindMph <= 0 ? "Any" : `${f.minWindMph} mph`}
        min={WIND_MIN - 1}
        max={WIND_MAX}
        step={1}
        // The first notch below 60 mph is "Any".
        onChange={(v) => update({ minWindMph: v < WIND_MIN ? 0 : v })}
        sliderValue={f.minWindMph <= 0 ? WIND_MIN - 1 : f.minWindMph}
      />
      <Slider
        label="Hail"
        value={f.minHailInches}
        display={f.minHailInches <= 0 ? "Any" : `${f.minHailInches.toFixed(2)} in`}
        min={0}
        max={HAIL_MAX}
        step={HAIL_STEP}
        onChange={(v) => update({ minHailInches: v })}
      />
      <p className="-mt-1 mb-2 text-xs text-muted-dim">Penny ≈ 0.75″ · quarter ≈ 1.00″ · golf ball ≈ 1.75″</p>
      <div className="flex items-center gap-3 py-2">
        <span className="w-16 text-sm">Tornado</span>
        <div className="flex flex-wrap gap-1.5">
          {[null, 0, 1, 2, 3, 4, 5].map((r) => (
            <Chip key={String(r)} on={f.minTornadoRating === r} onClick={() => update({ minTornadoRating: r })}>
              {r === null ? "Any" : `EF${r}+`}
            </Chip>
          ))}
        </div>
      </div>

      <SectionTitle>Reports from</SectionTitle>
      <div className="flex flex-wrap gap-2">
        {REPORT_DAY_OPTIONS.map((d) => (
          <Chip key={d} on={f.reportDays === d} onClick={() => update({ reportDays: d })}>
            {d === 1 ? "Today" : `Last ${d} days`}
          </Chip>
        ))}
      </div>

      <SectionTitle>SPC outlook</SectionTitle>
      <div className="flex flex-wrap gap-2">
        <Chip on={f.outlookKind === null} onClick={() => selectKind(null)}>
          Off
        </Chip>
        {OUTLOOK_KINDS.map((k) => (
          <Chip key={k} on={f.outlookKind === k} onClick={() => selectKind(k)}>
            {outlookKindTitle(k)}
          </Chip>
        ))}
      </div>
      {f.outlookKind && (
        <div className="mt-2 flex flex-wrap gap-2">
          {availableDays(f.outlookKind).map((d) => (
            <Chip key={d} on={f.outlookDay === d} onClick={() => update({ outlookDay: d })}>
              Day {d}
            </Chip>
          ))}
        </div>
      )}

      <SectionTitle>Radar</SectionTitle>
      <Switch label="Animated radar" checked={f.showRadar} onChange={(v) => update({ showRadar: v })} />
      {f.showRadar && (
        <Slider
          label="Opacity"
          value={f.radarOpacity}
          display={`${Math.round(f.radarOpacity * 100)}%`}
          min={0.1}
          max={1}
          step={0.05}
          onChange={(v) => update({ radarOpacity: v })}
        />
      )}
    </Sheet>
  );
}

function Slider({
  label,
  value,
  sliderValue,
  display,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  sliderValue?: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-3 py-2">
      <span className="w-16 text-sm">{label}</span>
      <input
        type="range"
        className="flex-1"
        min={min}
        max={max}
        step={step}
        value={sliderValue ?? value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="w-16 text-right text-sm tabular-nums text-muted">{display}</span>
    </label>
  );
}
