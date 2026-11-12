"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { usePrepProgress } from "@/lib/prep";
import { useProfile } from "@/lib/profile";
import type { PrepKit, PrepQuestion } from "@/lib/types";
import { JobPicker, jobKey, jobRef, type JobChoice } from "@/components/JobPicker";
import { ResourceList } from "@/components/ResourceList";
import { ErrorBox, Spinner, StatusChip, levelName } from "@/components/ui";

const TABS = [
  ["plan", "Weekly plan"],
  ["dsa", "DSA"],
  ["core", "Core subjects"],
  ["oa", "Online assessment"],
  ["questions", "Interview questions"],
  ["project", "Project"],
] as const;
type Tab = (typeof TABS)[number][0];

const KIND_STYLE: Record<string, string> = {
  dsa: "bg-indigo-50 text-indigo-700",
  core: "bg-amber-50 text-amber-800",
  aptitude: "bg-sky-50 text-sky-700",
  project: "bg-emerald-50 text-emerald-700",
};

function Check({ id, label, done, toggle, children }: {
  id: string; label: string; done: Set<string>; toggle: (id: string) => void; children?: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" className="mt-1 h-4 w-4 accent-indigo-600" checked={done.has(id)} onChange={() => toggle(id)} aria-label={label} />
      <span className={done.has(id) ? "text-slate-400 line-through" : ""}>{children ?? label}</span>
    </label>
  );
}

export function PrepClient() {
  const params = useSearchParams();
  const { profile, hasProfile } = useProfile();
  const [choice, setChoice] = useState<JobChoice>({ mode: "pick", jobId: params.get("job") ?? "", jobText: "" });
  const [hours, setHours] = useState(10);
  const [tab, setTab] = useState<Tab>("plan");
  const ref = jobRef(choice);
  const key = jobKey(choice);
  const { done, toggle } = usePrepProgress(key);

  const reqKey = useMemo(() => (ref ? JSON.stringify({ ref, hours, r: profile.resumeText, o: profile.overrides }) : null),
    [ref, hours, profile.resumeText, profile.overrides]);
  const [result, setResult] = useState<{ key: string; kit: PrepKit | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!reqKey || !ref) return;
    let cancelled = false;
    const t = setTimeout(() => {
      api.prep({ ...ref, resume_text: profile.resumeText || undefined, overrides: profile.overrides, hours_per_week: hours })
        .then((kit) => !cancelled && setResult({ key: reqKey, kit, error: null }))
        .catch((e) => !cancelled && setResult({ key: reqKey, kit: null, error: e.message }));
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
    // reqKey captures every input
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqKey]);

  const fresh = result && result.key === reqKey ? result : null;
  const kit = fresh?.kit ?? null;

  const allIds = useMemo(() => kit ? kit.schedule.flatMap((w) => w.items.map((i) => `${i.kind}:${i.ref}`)) : [], [kit]);
  const unique = [...new Set(allIds)];
  const progress = unique.length ? Math.round((100 * unique.filter((i) => done.has(i)).length) / unique.length) : 0;

  return (
    <div className="space-y-6">
      <div className="no-print grid gap-6 lg:grid-cols-[1fr_18rem]">
        <section className="card space-y-3 p-5" aria-labelledby="p-job-h">
          <h2 id="p-job-h" className="font-semibold text-slate-900">Which job are you preparing for?</h2>
          <JobPicker value={choice} onChange={setChoice} />
        </section>
        <section className="card space-y-3 p-5" aria-labelledby="p-time-h">
          <h2 id="p-time-h" className="font-semibold text-slate-900">Your time</h2>
          <label htmlFor="hours" className="label">Hours per week: {hours}</label>
          <input id="hours" type="range" min={3} max={30} step={1} value={hours} onChange={(e) => setHours(Number(e.target.value))} className="w-full accent-indigo-600" />
          <p className="text-xs text-slate-500">
            {hasProfile ? "Personalised to your resume and skill corrections." : <>No resume yet, so the plan starts from the basics. <Link href="/" className="underline">Add your resume</Link>.</>}
          </p>
        </section>
      </div>

      {!ref && <p className="text-sm text-slate-500">Choose a job to build your prep kit.</p>}
      {ref && !fresh && <Spinner label="Building your prep kit…" />}
      {fresh?.error && <ErrorBox message={fresh.error} />}

      {kit && (
        <div className="space-y-5">
          <section className="card flex flex-wrap items-center gap-6 p-5">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-slate-900">{kit.job_title ?? "Your target job"}{kit.company ? ` · ${kit.company}` : ""}</h2>
              <p className="text-sm text-slate-600">
                {kit.schedule.length} weeks at {kit.hours_per_week} h/week ({Math.round(kit.total_hours)} hours). You&apos;re {Math.round(kit.readiness)}% ready for this job today.
              </p>
            </div>
            <div className="w-48">
              <div className="mb-1 flex justify-between text-xs text-slate-500"><span>Progress</span><span>{progress}%</span></div>
              <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-emerald-500" style={{ width: `${progress}%` }} /></div>
            </div>
            <Link href={`/calendar?new=oa&title=${encodeURIComponent(`Online assessment${kit.company ? `: ${kit.company}` : ""}`)}`} className="btn-ghost no-print">
              Add OA date to calendar
            </Link>
          </section>

          <div className="no-print flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist" aria-label="Prep kit sections">
            {TABS.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-semibold ${tab === id ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-600 hover:text-slate-900"}`}>
                {label}
              </button>
            ))}
          </div>

          {tab === "plan" && (
            <ol className="grid gap-4 md:grid-cols-2">
              {kit.schedule.map((w) => (
                <li key={w.week} className="card p-5">
                  <h3 className="mb-2 flex justify-between font-semibold text-slate-900"><span>Week {w.week}</span><span className="text-sm font-normal text-slate-500">{w.hours} h</span></h3>
                  <ul className="space-y-2 text-sm">
                    {w.items.map((i) => (
                      <li key={i.kind + i.ref + i.title}>
                        <Check id={`${i.kind}:${i.ref}`} label={i.title} done={done} toggle={toggle}>
                          <span className={`mr-2 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase ${KIND_STYLE[i.kind]}`}>{i.kind}</span>
                          {i.title} <span className="text-slate-400">· {i.hours} h</span>
                        </Check>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
              {kit.schedule.length === 0 && <li className="text-sm text-slate-600">Nothing to schedule: you already cover what this job asks for.</li>}
            </ol>
          )}

          {tab === "dsa" && (
            <section className="space-y-4">
              <p className="text-sm text-slate-600">{kit.dsa.reason}</p>
              {kit.dsa.included && (
                <>
                  <ol className="space-y-3">
                    {kit.dsa.topics.map((t, i) => (
                      <li key={t.id} className="card p-5">
                        <Check id={`dsa:${t.id}`} label={t.name} done={done} toggle={toggle}>
                          <span className="font-semibold text-slate-900">{i + 1}. {t.name}</span>
                          <span className="ml-2 text-sm text-slate-500">{t.hours} h{t.review ? " · quick review" : ""}</span>
                        </Check>
                        <div className="mt-3 grid gap-4 pl-7 text-sm md:grid-cols-2">
                          <div>
                            <p className="mb-1 font-medium text-slate-700">Patterns to know</p>
                            <ul className="list-disc space-y-0.5 pl-5 text-slate-600">{t.patterns.map((p) => <li key={p}>{p}</li>)}</ul>
                          </div>
                          <div>
                            <p className="mb-1 font-medium text-slate-700">Can you do these?</p>
                            <ul className="list-disc space-y-0.5 pl-5 text-slate-600">{t.checklist.map((p) => <li key={p}>{p}</li>)}</ul>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                  {kit.dsa.resources.length > 0 && (
                    <div className="card p-5"><ResourceList resources={kit.dsa.resources} skill="DSA" /></div>
                  )}
                </>
              )}
            </section>
          )}

          {tab === "core" && (
            <section className="space-y-4">
              {kit.core.length === 0 && <p className="text-sm text-slate-600">This posting doesn&apos;t ask for CS core subjects.</p>}
              {kit.core.map((c) => (
                <div key={c.skill_id} className="card space-y-3 p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Check id={`core:${c.skill_id}`} label={c.name} done={done} toggle={toggle}>
                      <span className="font-semibold text-slate-900">{c.name}</span>
                    </Check>
                    {c.status && <StatusChip status={c.status} />}
                    <span className="text-sm text-slate-500">· asks {levelName(c.required_level)}, you&apos;re {levelName(c.candidate_level)} · {c.hours} h</span>
                  </div>
                  <ul className="grid list-disc gap-x-6 gap-y-0.5 pl-12 text-sm text-slate-600 md:grid-cols-2">{c.topics.map((t) => <li key={t}>{t}</li>)}</ul>
                  {c.resources.length > 0 && <div className="pl-7"><ResourceList resources={c.resources} skill={c.name} /></div>}
                </div>
              ))}
              <div className="card space-y-3 p-5">
                <h3 className="font-semibold text-slate-900">Aptitude</h3>
                <p className="text-sm text-slate-600">{kit.aptitude_note}</p>
                <div className="grid gap-4 md:grid-cols-3">
                  {kit.aptitude.map((a) => (
                    <div key={a.area}>
                      <Check id={`aptitude:${a.area}`} label={a.area} done={done} toggle={toggle}>
                        <span className="font-medium text-slate-800">{a.area}</span> <span className="text-sm text-slate-500">· {a.hours} h</span>
                      </Check>
                      <ul className="mt-1 list-disc pl-12 text-sm text-slate-600">{a.topics.map((t) => <li key={t}>{t}</li>)}</ul>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {tab === "oa" && (
            <section className="space-y-4">
              {kit.posting_process.length > 0 && (
                <div className="card p-5">
                  <h3 className="mb-2 font-semibold text-slate-900">What this posting says about the process</h3>
                  <ul className="space-y-1 text-sm text-slate-700">{kit.posting_process.map((l) => <li key={l}>&ldquo;{l}&rdquo;</li>)}</ul>
                </div>
              )}
              <p className="text-sm text-slate-600">
                Common online assessment formats for early-career tech roles. The ones this posting points to come first. Formats vary by company; check your test invite.
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                {kit.oa_formats.map((f) => (
                  <div key={f.id} className={`card p-5 ${f.relevant ? "ring-2 ring-indigo-200" : ""}`}>
                    <h3 className="font-semibold text-slate-900">{f.name}</h3>
                    {f.reason && <p className="text-xs font-medium text-indigo-700">{f.reason}</p>}
                    <p className="mt-1 text-sm text-slate-600">{f.what}</p>
                    <ul className="mt-2 list-disc pl-5 text-sm text-slate-600">{f.prepare.map((p) => <li key={p}>{p}</li>)}</ul>
                  </div>
                ))}
              </div>
            </section>
          )}

          {tab === "questions" && (
            <section className="space-y-4">
              <div className="card p-5">
                <h3 className="font-semibold text-slate-900">About this job</h3>
                <p className="mb-3 text-sm text-slate-600">
                  Practice questions built from the posting itself. Each one shows the line it comes from. These aren&apos;t questions the company is known to ask.
                </p>
                <QuestionList questions={kit.company_questions} />
              </div>
              <div className="card p-5">
                <h3 className="font-semibold text-slate-900">Behavioral</h3>
                <p className="mb-3 text-sm text-slate-600">{kit.star_tip}</p>
                <QuestionList questions={kit.behavioral} />
              </div>
            </section>
          )}

          {tab === "project" && (
            <section className="space-y-4">
              <p className="text-sm text-slate-600">Projects chosen to close your gaps for this job. Build one, put it on your resume, and your gap report updates.</p>
              {kit.projects.length === 0 && <p className="text-sm text-slate-600">No project template fits this job yet.</p>}
              {kit.projects.map((p, idx) => (
                <div key={p.id} className={`card space-y-3 p-5 ${idx === 0 ? "ring-2 ring-emerald-200" : ""}`}>
                  <div>
                    <h3 className="font-semibold text-slate-900">{idx === 0 ? "Recommended: " : ""}{p.title} <span className="text-sm font-normal text-slate-500">· ~{p.hours} h</span></h3>
                    <p className="text-sm text-slate-600">{p.pitch}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {p.covers.map((c) => <span key={c} className="rounded-full bg-rose-50 px-2 py-0.5 font-medium text-rose-800 ring-1 ring-rose-200">closes {c}</span>)}
                    {p.builds_on.map((c) => <span key={c} className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">uses your {c}</span>)}
                  </div>
                  <ol className="space-y-1.5 text-sm">
                    {p.milestones.map((m, i) => (
                      <li key={m}><Check id={`project:${p.id}:${i}`} label={m} done={done} toggle={toggle}>{i + 1}. {m}</Check></li>
                    ))}
                  </ol>
                  {p.stretch.length > 0 && <p className="text-sm text-slate-500">Stretch: {p.stretch.join(" · ")}</p>}
                </div>
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function QuestionList({ questions }: { questions: PrepQuestion[] }) {
  return (
    <ul className="space-y-3">
      {questions.map((q, i) => (
        <li key={i} className="text-sm">
          <p className="text-slate-900">
            <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">{q.theme}</span>
            {q.question}
            {q.source === "ai" && <span className="ml-2 text-[11px] font-semibold text-indigo-600">AI · grounded in posting</span>}
          </p>
          {q.quote && <p className="mt-0.5 border-l-2 border-slate-200 pl-2 text-xs text-slate-500">Posting: &ldquo;{q.quote}&rdquo;</p>}
        </li>
      ))}
    </ul>
  );
}
