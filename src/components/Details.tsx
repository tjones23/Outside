"use client";

import { categoryColor, categoryGlyph, categoryName } from "@/lib/categories";
import { formatDateTime, formatUtcTime } from "@/lib/format";
import { dayLabel } from "@/lib/reports";
import type { StormAlert, StormReport } from "@/lib/types";
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
          ["Area", alert.areaDesc ?? "—"],
          ["Severity", alert.severity ?? "—"],
          ["Effective", formatDateTime(alert.effective)],
          ["Expires", formatDateTime(alert.expires)],
          ["Issued by", alert.senderName ?? "—"],
        ]}
      />
      {alert.description && (
        <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-muted">{alert.description}</p>
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
