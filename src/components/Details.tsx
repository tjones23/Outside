"use client";

import { alertGroupName, alertLevelName } from "@/lib/alert-catalog";
import { categoryColor, categoryGlyph, categoryName } from "@/lib/categories";
import { formatDateTime, formatUtcTime } from "@/lib/format";
import { dayLabel } from "@/lib/reports";
import { coastalName, currentStage, ktToMph, stageColor } from "@/lib/tropical";
import type { StormAlert, StormReport, TropicalStorm } from "@/lib/types";
import { useNow } from "./providers/useNow";
import { Sheet } from "./ui/Sheet";
import { Facts } from "./ui/controls";

export function AlertDetail({ alert, onClose }: { alert: StormAlert; onClose: () => void }) {
  return (
    <Sheet title={alert.event} onClose={onClose}>
      <div className="mb-3 h-1 rounded-full" style={{ background: alert.color }} />
      {alert.headline && <p className="mb-3 text-sm leading-relaxed">{alert.headline}</p>}
      <Facts
        rows={[
          ["Type", `${alertGroupName(alert.group)} · ${alertLevelName(alert.level, false)}`],
          ["Area", alert.areaDesc ?? "—"],
          ["Severity", alert.severity ?? "—"],
          ["Effective", formatDateTime(alert.effective)],
          ["Until", formatDateTime(alert.expires)],
          ["Issued by", alert.senderName ?? "—"],
        ]}
      />
      {alert.description && (
        <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-muted">{alert.description}</p>
      )}
      {alert.instruction && (
        <>
          <h3 className="mt-4 text-xs font-semibold uppercase tracking-widest text-muted-dim">What to do</h3>
          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-muted">{alert.instruction}</p>
        </>
      )}
      <a
        href={alert.id}
        target="_blank"
        rel="noreferrer noopener"
        className="mt-4 inline-block text-sm text-accent underline-offset-2 hover:underline"
      >
        Full text at weather.gov ↗
      </a>
    </Sheet>
  );
}

export function ReportDetail({ report, onClose }: { report: StormReport; onClose: () => void }) {
  const now = useNow();
  return (
    <Sheet title={`${categoryGlyph(report.category)} ${report.title}`} onClose={onClose}>
      <div className="mb-3 h-1 rounded-full" style={{ background: categoryColor(report.category) }} />
      <Facts
        rows={[
          ["Type", categoryName(report.category)],
          ["Magnitude", report.magnitude || "—"],
          ["Location", report.location || "—"],
          ["County", report.county ? `${report.county} Co` : "—"],
          ["State", report.state || "—"],
          ["Time", `${formatUtcTime(report.time)} · ${dayLabel(report.date, new Date(now))}`],
          ["Coordinates", `${report.coord[0].toFixed(2)}, ${report.coord[1].toFixed(2)}`],
        ]}
      />
      {report.comments && <p className="mt-4 text-sm leading-relaxed text-muted">{report.comments}</p>}
    </Sheet>
  );
}

export function TropicalDetail({ storm, onClose }: { storm: TropicalStorm; onClose: () => void }) {
  const kinds = [...new Set(storm.coastal.map((c) => c.kind))];
  const peak = storm.forecast.reduce<number | null>(
    (max, p) => (p.windKt !== null && (max === null || p.windKt > max) ? p.windKt : max),
    null,
  );
  return (
    <Sheet title={`🌀 ${storm.title}`} onClose={onClose}>
      <div className="mb-3 h-1 rounded-full" style={{ background: stageColor(currentStage(storm)) }} />
      <Facts
        rows={[
          ["Winds", storm.windMph !== null ? `${storm.windMph} mph` : "—"],
          ["Pressure", storm.pressureMb !== null ? `${storm.pressureMb} mb` : "—"],
          ["Moving", storm.movement ?? "Stationary"],
          ["Position", `${storm.position[0].toFixed(1)}°, ${storm.position[1].toFixed(1)}°`],
          ["Peak forecast", peak !== null ? `${ktToMph(peak)} mph` : "—"],
          ["Coastal alerts", kinds.length ? kinds.map(coastalName).join(", ") : "None"],
          ["Advisory", storm.advisoryNumber ? `#${Number(storm.advisoryNumber)} · ${formatDateTime(storm.updated)}` : formatDateTime(storm.updated)],
        ]}
      />
      {storm.forecast.length > 1 && (
        <>
          <h3 className="mt-4 text-xs font-semibold uppercase tracking-widest text-muted-dim">Forecast</h3>
          <ul className="mt-1 divide-y divide-line-soft text-sm">
            {storm.forecast.slice(1).map((p) => (
              <li key={p.tau} className="flex items-center gap-3 py-1.5">
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-black"
                  style={{ background: stageColor(p.stage) }}
                  aria-hidden="true"
                >
                  {p.stage}
                </span>
                <span className="min-w-0 flex-1 truncate">{p.label || `${p.tau} h`}</span>
                <span className="shrink-0 tabular-nums text-muted">
                  {p.windKt !== null ? `${ktToMph(p.windKt)} mph` : "—"}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1">
        {storm.links.map((l) => (
          <a
            key={l.href}
            href={l.href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-sm text-accent underline-offset-2 hover:underline"
          >
            {l.label} ↗
          </a>
        ))}
      </div>
    </Sheet>
  );
}
