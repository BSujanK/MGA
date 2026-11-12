import type { MarketReport } from "@/lib/types";
import { levelName } from "@/components/ui";

/**
 * Demand as a dark, high-contrast bar chart built from plain divs.
 * Bar length = share of postings asking for the skill; the bright part = share asking for it as a must-have.
 * Skills the candidate has a gap in are drawn in Nitro and tagged, so they are findable at a glance.
 */
export function DemandChart({ report, className = "" }: { report: MarketReport; className?: string }) {
  const gapIds = new Set(report.candidate_gaps.filter((g) => g.status !== "strong").map((g) => g.skill_id));
  const gapCount = report.skills.filter((s) => gapIds.has(s.skill_id)).length;
  return (
    <section className={`surface-dark relative overflow-hidden px-6 py-10 sm:px-10 sm:py-12 ${className}`} aria-labelledby="demand-h">
      <div className="flex items-start justify-between gap-6">
        <div className="space-y-4">
          <h2 id="demand-h" className="eyebrow flex items-center gap-2 text-stone-400">
            <span className="h-1.5 w-1.5 rounded-full bg-nitro" aria-hidden />Skill demand
          </h2>
          <p className="numeral text-[7rem] leading-[0.85] sm:text-[10rem]">{report.postings_analyzed}</p>
          <p className="text-[0.9375rem] font-light text-stone-400">postings read. Share that ask for each skill:</p>
        </div>
      </div>

      <ul className="mt-10 space-y-5">
        {report.skills.map((s, i) => {
          const isGap = gapIds.has(s.skill_id);
          const freq = Math.round(s.frequency * 100);
          return (
            <li key={s.skill_id} className="space-y-2" title={`Typical level: ${levelName(s.avg_required_level)}; must-have in ${Math.round(s.must_rate * 100)}%`}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span aria-hidden className="numeral w-5 shrink-0 text-xs text-stone-500">{i + 1}</span>
                  <span className={`font-semibold tracking-[-0.01em] ${i < 3 ? "text-xl" : "text-[0.9375rem]"}`}>{s.name}</span>
                  {isGap && <span className="relative top-[-0.15em] h-1.5 w-1.5 shrink-0 self-center rounded-full bg-nitro" title="Your gap"><span className="sr-only">Your gap</span></span>}
                </span>
                <span className={`numeral shrink-0 ${i < 3 ? "text-2xl" : "text-lg"} ${isGap ? "text-nitro" : ""}`}>{freq}<span className="text-stone-500">%</span></span>
              </div>
              <div className={`relative rounded-full bg-stone-800 ${i < 3 ? "h-3" : "h-2"}`}>
                <div className={`absolute inset-y-0 left-0 rounded-full ${isGap ? "bg-nitro/35" : "bg-stone-600"}`} style={{ width: `${freq}%` }} />
                <div className={`absolute inset-y-0 left-0 rounded-full ${isGap ? "bg-nitro" : "bg-whiteout"}`} style={{ width: `${s.frequency * s.must_rate * 100}%` }} />
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-stone-700 pt-5 text-[0.75rem] text-stone-400">
        <span className="flex items-center gap-2"><span className="h-2 w-5 rounded-full bg-whiteout" aria-hidden />Asked as a must-have</span>
        <span className="flex items-center gap-2"><span className="h-2 w-5 rounded-full bg-stone-600" aria-hidden />Asked at all</span>
        <span className="flex items-center gap-2"><span className="h-2 w-5 rounded-full bg-nitro" aria-hidden />Your gap{gapCount ? ` (${gapCount})` : ""}</span>
      </div>
    </section>
  );
}
