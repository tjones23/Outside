"use client";

import { currentStage, stageColor } from "@/lib/tropical";
import type { TropicalStorm } from "@/lib/types";

/** One pill per active NHC storm; tapping flies to it and opens its details. */
export function StormChips({ storms, onSelect }: { storms: TropicalStorm[]; onSelect: (storm: TropicalStorm) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {storms.map((storm) => (
        <button
          key={storm.id}
          type="button"
          onClick={() => onSelect(storm)}
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-ink/85 px-2.5 py-1 text-xs text-text shadow-lg backdrop-blur-md hover:border-muted-dim"
        >
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: stageColor(currentStage(storm)) }}
          />
          <span title={storm.title}>{storm.name}</span>
          <span className="text-muted">
            {storm.classification}
            {storm.windMph !== null && ` · ${storm.windMph} mph`}
          </span>
        </button>
      ))}
    </div>
  );
}
