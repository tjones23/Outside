import { PASS_LABEL, type SkiPass } from "@/lib/resorts";

const STYLE: Record<SkiPass, string> = {
  epic: "border-snow/50 text-snow",
  ikon: "border-accent/50 text-accent",
  independent: "border-line text-muted",
};

/** "Epic", "Ikon" or "Independent", as a small outlined tag. */
export function PassBadge({ pass }: { pass: SkiPass }) {
  return (
    <span className={`inline-block shrink-0 rounded-full border px-1.5 py-px text-[11px] font-medium leading-4 ${STYLE[pass]}`}>
      {PASS_LABEL[pass]}
    </span>
  );
}
