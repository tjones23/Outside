"use client";

import { useFilters } from "@/lib/client-store";
import { HAIL_MAX, HAIL_STEP, REPORT_DAY_OPTIONS, WIND_MAX, WIND_MIN } from "@/lib/filters";
import { FORECAST_PRODUCTS } from "@/lib/forecast";
import { availableDays, clampDay, OUTLOOK_KINDS, outlookKindChip } from "@/lib/outlook";
import type { ForecastProductId, OutlookKind } from "@/lib/types";
import { AlertGroupChips, AlertKindChips, CategoryChips } from "./FilterChips";
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

  // Radar and the forecast animations share the map's imagery slot.
  const imagery: "off" | "radar" | ForecastProductId = f.forecastProduct ?? (f.showRadar ? "radar" : "off");
  const selectImagery = (next: typeof imagery) =>
    update({
      showRadar: next === "radar",
      forecastProduct: next === "off" || next === "radar" ? null : next,
    });

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
      <div className="mt-2">
        <AlertGroupChips />
      </div>
      <p className="mt-1.5 text-xs text-muted-dim">
        Tornado / wind / hail above also apply to tornado and severe thunderstorm alerts.
      </p>

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

      <SectionTitle>Outlook</SectionTitle>
      <div className="flex flex-wrap gap-2">
        <Chip on={f.outlookKind === null} onClick={() => selectKind(null)}>
          Off
        </Chip>
        {OUTLOOK_KINDS.map((k) => (
          <Chip key={k} on={f.outlookKind === k} onClick={() => selectKind(k)}>
            {outlookKindChip(k)}
          </Chip>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-muted-dim">
        Storm Prediction Center convective risk, or the Weather Prediction Center&apos;s excessive rainfall (flash
        flood) risk.
      </p>
      {f.outlookKind && (
        <div className="mt-2 flex flex-wrap gap-2">
          {availableDays(f.outlookKind).map((d) => (
            <Chip key={d} on={f.outlookDay === d} onClick={() => update({ outlookDay: d })}>
              Day {d}
            </Chip>
          ))}
        </div>
      )}

      <SectionTitle>Tropical</SectionTitle>
      <Switch
        label="Hurricanes and tropical storms"
        description="National Hurricane Center tracks, forecast cones, coastal watches and warnings, and areas to watch."
        checked={f.showTropical}
        onChange={(v) => update({ showTropical: v })}
      />

      <SectionTitle>Radar &amp; forecast</SectionTitle>
      <div className="flex flex-wrap gap-2">
        <Chip on={imagery === "off"} onClick={() => selectImagery("off")}>
          Off
        </Chip>
        <Chip on={imagery === "radar"} onClick={() => selectImagery("radar")}>
          Radar (past hour)
        </Chip>
      </div>
      <p className="mb-1.5 mt-3 text-xs text-muted-dim">Forecast animations</p>
      <div className="flex flex-wrap gap-2">
        {FORECAST_PRODUCTS.map((p) => (
          <Chip key={p.id} on={imagery === p.id} onClick={() => selectImagery(p.id)}>
            {p.name}
          </Chip>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-muted-dim">
        Future radar is NOAA&apos;s HRRR model, 18 hours ahead hour by hour. The rest are the National Weather
        Service&apos;s forecast, a week ahead.
      </p>
      {imagery !== "off" && (
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
