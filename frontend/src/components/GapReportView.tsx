"use client";

import { useState } from "react";
import type { GapReport, GapStatus, SkillGap } from "@/lib/types";
import { GapGlyph, ImportanceChip, LevelBar, STATUS, StatusChip, hoursLabel, levelName } from "./ui";
import { ResourceList } from "./ResourceList";

const ORDER: GapStatus[] = ["missing", "transferable", "partial", "strong"];

function wholeHours(v: number) {
  return v <= 0 ? 0 : v < 1.5 ? 1 : Math.round(v);
}

/** Hours as a small numeral + unit; "Ready" when nothing is left to close. */
function Hours({ value }: { value: number }) {
  if (value <= 0) return <span className="text-[0.9375rem] font-semibold text-royal">Ready</span>;
  const n = wholeHours(value);
  return (
    <span aria-label={hoursLabel(value)} className="inline-flex items-baseline gap-1.5">
      <span aria-hidden className="numeral text-3xl leading-none">{n}</span>
      <span aria-hidden className="eyebrow">{n === 1 ? "hour" : "hours"}</span>
    </span>
  );
}

/** The heart of the report: one huge readiness number, the focus-first line, then the supporting facts. */
export function GapSummaryCard({ report }: { report: GapReport }) {
  const s = report.summary;
  const readiness = Math.round(s.readiness);
  const coverage = Math.round(s.must_have_coverage);
  return (
    <section className="surface-dark relative overflow-hidden px-6 py-10 sm:px-12 sm:py-14" aria-labelledby="summary-h">
      <GapGlyph className="pointer-events-none absolute -right-24 -top-16 hidden w-[30rem] sm:block text-stone-800 opacity-80" />
      <div className="relative grid gap-12 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          <h2 id="summary-h" className="eyebrow flex items-center gap-2 text-stone-400">
            <span className="h-1.5 w-1.5 rounded-full bg-nitro" aria-hidden />
            {report.job.title ?? "This job"}{report.job.company ? ` · ${report.job.company}` : ""}
          </h2>
          <div role="img" aria-label={`Overall readiness: ${readiness}%`}>
            <p aria-hidden className="numeral -ml-2 text-[9rem] leading-[0.85] sm:text-[15rem]">
              {readiness}<span className="text-nitro">%</span>
            </p>
            <p aria-hidden className="eyebrow mt-4 text-stone-400">Overall readiness</p>
          </div>
          <p className="title max-w-xl text-whiteout">{s.headline}</p>
        </div>

        <div className="space-y-10 self-end lg:col-span-5">
          <div className="grid grid-cols-2 gap-x-6 gap-y-8">
            <div className="border-t border-stone-700 pt-4">
              <p className="numeral text-5xl leading-none">{coverage}<span className="text-stone-400">%</span></p>
              <p className="eyebrow mt-3 text-stone-400">Must-haves covered</p>
            </div>
            <div className="border-t border-stone-700 pt-4">
              <p aria-hidden className="numeral text-5xl leading-none">
                {wholeHours(s.est_hours_to_close)}
                <span className="ml-1 text-lg font-light text-stone-400">h</span>
              </p>
              <p className="eyebrow mt-3 text-stone-400">To close every gap</p>
              <span className="sr-only">{hoursLabel(s.est_hours_to_close)}</span>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-6 border-t border-stone-700 pt-5 sm:grid-cols-4">
            {ORDER.map((st) => (
              <div key={st} className="flex flex-col-reverse gap-2">
                <dt className="flex items-center gap-1.5 text-[0.75rem] text-stone-400">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS[st].dot}`} aria-hidden />
                  {STATUS[st].label}
                </dt>
                <dd className="numeral text-3xl leading-none">{s[st]}</dd>
              </div>
            ))}
          </dl>
          {report.job.extractor !== "rules" && (
            <p className="text-[0.75rem] text-stone-400">Read with Claude + rule engine ({report.job.extractor}).</p>
          )}
        </div>
      </div>
    </section>
  );
}

export function GapCard({ gap, defaultOpen = false, compact = false }: { gap: SkillGap; defaultOpen?: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const note =
    gap.satisfied_by ? `Met by your ${gap.alternatives.length ? "alternative skill" : "related skill"}`
    : gap.status === "transferable" && gap.transfer_from ? `Partial credit from a related skill you have`
    : null;
  return (
    <li className="card overflow-hidden transition hover:ring-stone-400/50">
      <button
        type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className={`grid w-full gap-5 p-5 text-left sm:p-6 ${compact ? "" : "sm:grid-cols-12 sm:items-center"}`}
      >
        <div className={`min-w-0 space-y-3 ${compact ? "" : "sm:col-span-5"}`}>
          <div className="flex items-start gap-3">
            <span className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${STATUS[gap.status].dot}`} aria-hidden />
            <span className="text-xl font-semibold leading-tight tracking-[-0.02em]">{gap.name}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 pl-[1.375rem]">
            <StatusChip status={gap.status} />
            <ImportanceChip importance={gap.importance} />
            {gap.alternatives.length > 0 && (
              <span className="muted">or {gap.alternatives.join(", ")}</span>
            )}
          </div>
        </div>
        <div className={`space-y-2 ${compact ? "" : "sm:col-span-5"}`}>
          <LevelBar have={gap.effective_level} need={gap.required_level} status={gap.status} />
          <p className="muted flex justify-between gap-3">
            <span>You: <span className="font-medium text-stone-700">{levelName(gap.effective_level)}</span></span>
            <span>Asked: <span className="font-medium text-stone-700">{levelName(gap.required_level)}</span></span>
          </p>
        </div>
        <div className={`flex items-center justify-between gap-3 ${compact ? "" : "sm:col-span-2 sm:justify-end"}`}>
          <Hours value={gap.est_hours} />
          <span aria-hidden className={`text-stone-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}>⌄</span>
        </div>
      </button>
      {open && (
        <div className={`grid gap-8 border-t border-fusion-light bg-fusion-50 p-5 text-[0.9375rem] sm:p-8 ${compact ? "" : "md:grid-cols-2"}`}>
          <div className="space-y-6">
            <p className="leading-relaxed text-stone-600">
              Job asks for <b className="font-semibold text-stone">{levelName(gap.required_level)}</b> ({gap.required_level.toFixed(1)}/5).
              {" "}You&apos;re at <b className="font-semibold text-stone">{levelName(gap.candidate_level)}</b> ({gap.candidate_level.toFixed(1)}/5)
              {gap.effective_level > gap.candidate_level ? <>, counted as {gap.effective_level.toFixed(1)} with related skills</> : null}.
              {note ? <span className="muted mt-1 block">{note}.</span> : null}
            </p>
            <Evidence title="From the job posting" items={gap.job_evidence.map((e) => e.text)} />
            <Evidence title="From your resume" items={gap.candidate_evidence.map((e) => e.text)} empty="Nothing in your resume shows this skill yet." />
          </div>
          <div>
            {gap.status === "strong" ? (
              <p className="leading-relaxed text-stone-600">You&apos;re covered here. Make sure your resume shows a concrete result that used {gap.name}.</p>
            ) : (
              <ResourceList resources={gap.resources} skill={gap.name} />
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function Evidence({ title, items, empty }: { title: string; items: string[]; empty?: string }) {
  return (
    <div className="space-y-2">
      <h4 className="eyebrow">{title}</h4>
      {items.length ? (
        <ul className="space-y-2">
          {items.map((t, i) => (
            <li key={i} className="rounded-2xl bg-white px-4 py-3 text-[0.9375rem] font-light leading-relaxed text-stone-700 ring-1 ring-fusion-light">“{t}”</li>
          ))}
        </ul>
      ) : (
        <p className="muted">{empty}</p>
      )}
    </div>
  );
}

export function GapList({ gaps }: { gaps: SkillGap[] }) {
  const open = gaps.filter((g) => g.status !== "strong");
  const strong = gaps.filter((g) => g.status === "strong");
  const hours = Math.round(open.reduce((a, g) => a + g.est_hours, 0));
  return (
    <div className="space-y-24">
      <section aria-labelledby="todo-h" className="space-y-8">
        <div className="grid items-end gap-4 border-t border-fusion pt-8 lg:grid-cols-12">
          <div className="flex items-start gap-5 lg:col-span-8">
            <span aria-hidden className="numeral text-[4.5rem] leading-[0.8] text-fusion sm:text-[6rem]">01</span>
            <h2 id="todo-h" className="title">
              Your plan, in priority order
              <span className="block font-extralight text-stone-400">Start at the top.</span>
            </h2>
          </div>
          {open.length > 0 && (
            <p className="muted lg:col-span-4 lg:text-right">{open.length} {open.length === 1 ? "skill" : "skills"} · about {hours} hours in total</p>
          )}
        </div>
        {open.length ? (
          <ol className="space-y-4">{open.map((g, i) => <GapCard key={g.skill_id} gap={g} defaultOpen={i === 0} />)}</ol>
        ) : (
          <p className="lede">No gaps. You cover everything this job asks for.</p>
        )}
      </section>
      {strong.length > 0 && (
        <section aria-labelledby="strong-h" className="space-y-8">
          <div className="flex items-start gap-5 border-t border-fusion pt-8">
            <span aria-hidden className="numeral text-[4.5rem] leading-[0.8] text-fusion sm:text-[6rem]">02</span>
            <h2 id="strong-h" className="title">
              Already strong
              <span className="block font-extralight text-stone-400">{strong.length} {strong.length === 1 ? "skill" : "skills"} you can lean on.</span>
            </h2>
          </div>
          <ul className="space-y-4">{strong.map((g) => <GapCard key={g.skill_id} gap={g} />)}</ul>
        </section>
      )}
    </div>
  );
}
