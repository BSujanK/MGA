"use client";

import { useState } from "react";
import type { GapReport, GapStatus, SkillGap } from "@/lib/types";
import { ImportanceChip, LevelBar, ReadinessRing, STATUS, StatusChip, hoursLabel, levelName } from "./ui";
import { ResourceList } from "./ResourceList";

const ORDER: GapStatus[] = ["missing", "transferable", "partial", "strong"];

export function GapSummaryCard({ report }: { report: GapReport }) {
  const s = report.summary;
  return (
    <section className="card p-6" aria-labelledby="summary-h">
      <div className="flex flex-col gap-6 md:flex-row md:items-center">
        <div className="flex gap-6">
          <ReadinessRing value={s.readiness} label="Overall readiness" />
          <ReadinessRing value={s.must_have_coverage} label="Must-haves covered" />
        </div>
        <div className="flex-1 space-y-3">
          <h2 id="summary-h" className="text-lg font-bold text-slate-900">
            {report.job.title ?? "This job"}{report.job.company ? ` · ${report.job.company}` : ""}
          </h2>
          <p className="text-slate-700">{s.headline}</p>
          <dl className="flex flex-wrap gap-3 text-sm">
            {ORDER.map((st) => (
              <div key={st} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5">
                <span className={`h-2.5 w-2.5 rounded-full ${STATUS[st].dot}`} />
                <dt className="text-slate-600">{STATUS[st].label}</dt>
                <dd className="font-semibold text-slate-900">{s[st]}</dd>
              </div>
            ))}
            <div className="flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-1.5">
              <dt className="text-indigo-700">To close every gap</dt>
              <dd className="font-semibold text-indigo-900">{hoursLabel(s.est_hours_to_close)}</dd>
            </div>
          </dl>
          {report.job.extractor !== "rules" && (
            <p className="text-xs text-slate-500">Read with Claude + rule engine ({report.job.extractor}).</p>
          )}
        </div>
      </div>
    </section>
  );
}

export function GapCard({ gap, defaultOpen = false }: { gap: SkillGap; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const note =
    gap.satisfied_by ? `Met by your ${gap.alternatives.length ? "alternative skill" : "related skill"}`
    : gap.status === "transferable" && gap.transfer_from ? `Partial credit from a related skill you have`
    : null;
  return (
    <li className="card overflow-hidden">
      <button
        type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-full flex-col gap-3 p-4 text-left hover:bg-slate-50 sm:flex-row sm:items-center"
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-900">{gap.name}</span>
          <StatusChip status={gap.status} />
          <ImportanceChip importance={gap.importance} />
          {gap.alternatives.length > 0 && (
            <span className="text-xs text-slate-500">or {gap.alternatives.join(", ")}</span>
          )}
        </div>
        <div className="flex w-full items-center gap-3 sm:w-80">
          <div className="flex-1"><LevelBar have={gap.effective_level} need={gap.required_level} status={gap.status} /></div>
          <span className="w-24 shrink-0 text-right text-xs font-medium text-slate-600">{hoursLabel(gap.est_hours)}</span>
        </div>
      </button>
      {open && (
        <div className="grid gap-4 border-t border-slate-100 bg-slate-50/60 p-4 text-sm md:grid-cols-2">
          <div className="space-y-3">
            <p className="text-slate-700">
              Job asks for <b>{levelName(gap.required_level)}</b> ({gap.required_level.toFixed(1)}/5).
              {" "}You&apos;re at <b>{levelName(gap.candidate_level)}</b> ({gap.candidate_level.toFixed(1)}/5)
              {gap.effective_level > gap.candidate_level ? <>, counted as {gap.effective_level.toFixed(1)} with related skills</> : null}.
              {note ? <span className="block text-slate-500">{note}.</span> : null}
            </p>
            <Evidence title="From the job posting" items={gap.job_evidence.map((e) => e.text)} />
            <Evidence title="From your resume" items={gap.candidate_evidence.map((e) => e.text)} empty="Nothing in your resume shows this skill yet." />
          </div>
          <div>
            {gap.status === "strong" ? (
              <p className="text-slate-600">You&apos;re covered here. Make sure your resume shows a concrete result that used {gap.name}.</p>
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
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h4>
      {items.length ? (
        <ul className="space-y-1">
          {items.map((t, i) => (
            <li key={i} className="rounded-lg border-l-4 border-slate-300 bg-white px-3 py-1.5 text-slate-700">“{t}”</li>
          ))}
        </ul>
      ) : (
        <p className="text-slate-500">{empty}</p>
      )}
    </div>
  );
}

export function GapList({ gaps }: { gaps: SkillGap[] }) {
  const open = gaps.filter((g) => g.status !== "strong");
  const strong = gaps.filter((g) => g.status === "strong");
  return (
    <div className="space-y-8">
      <section aria-labelledby="todo-h">
        <h2 id="todo-h" className="mb-3 text-lg font-bold text-slate-900">Your plan, in priority order</h2>
        {open.length ? (
          <ol className="space-y-3">{open.map((g, i) => <GapCard key={g.skill_id} gap={g} defaultOpen={i === 0} />)}</ol>
        ) : (
          <p className="text-slate-600">No gaps. You cover everything this job asks for.</p>
        )}
      </section>
      {strong.length > 0 && (
        <section aria-labelledby="strong-h">
          <h2 id="strong-h" className="mb-3 text-lg font-bold text-slate-900">Already strong</h2>
          <ul className="space-y-3">{strong.map((g) => <GapCard key={g.skill_id} gap={g} />)}</ul>
        </section>
      )}
    </div>
  );
}
