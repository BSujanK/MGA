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
  dsa: "bg-royal-soft text-royal",
  core: "bg-nitro-soft text-[#c2410c]",
  aptitude: "bg-fusion-light text-stone-700",
  project: "bg-stone text-whiteout",
};

/** A satisfying checkbox: the native input stays (keyboard, screen readers); the box is drawn beside it. */
function Check({ id, label, done, toggle, children }: {
  id: string; label: string; done: Set<string>; toggle: (id: string) => void; children?: React.ReactNode;
}) {
  const checked = done.has(id);
  return (
    <label className="group flex cursor-pointer items-start gap-3.5">
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={() => toggle(id)} aria-label={label} />
      <span aria-hidden
        className="mt-px grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[7px] bg-white text-whiteout ring-1 ring-inset ring-stone-400 transition duration-200 group-hover:ring-stone group-active:scale-90 peer-checked:bg-stone peer-checked:ring-stone peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-royal [&>svg]:scale-50 [&>svg]:opacity-0 [&>svg]:transition [&>svg]:duration-200 peer-checked:[&>svg]:scale-100 peer-checked:[&>svg]:opacity-100">
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 8.5l3 3 6-7" /></svg>
      </span>
      <span className={`min-w-0 flex-1 transition ${checked ? "text-stone-400 line-through decoration-stone-400/60" : ""}`}>{children ?? label}</span>
    </label>
  );
}

function TabIntro({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="grid gap-3 lg:grid-cols-12 lg:items-end">
      <h2 className="title lg:col-span-5">{title}</h2>
      {children && <p className="muted max-w-xl lg:col-span-7">{children}</p>}
    </div>
  );
}

function Bullets({ items, className = "" }: { items: string[]; className?: string }) {
  return (
    <ul className={`space-y-1.5 text-[0.9375rem] text-stone-600 ${className}`}>
      {items.map((p) => (
        <li key={p} className="flex gap-2.5"><span aria-hidden className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full bg-stone-400" />{p}</li>
      ))}
    </ul>
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
  const doneCount = unique.filter((i) => done.has(i)).length;
  const progress = unique.length ? Math.round((100 * doneCount) / unique.length) : 0;

  // Per-week completion drives the segmented progress bar and the timeline nodes.
  const weekState = kit ? kit.schedule.map((w) => {
    const ids = [...new Set(w.items.map((i) => `${i.kind}:${i.ref}`))];
    const n = ids.filter((i) => done.has(i)).length;
    return { total: ids.length, done: n, pct: ids.length ? (100 * n) / ids.length : 0, complete: ids.length > 0 && n === ids.length };
  }) : [];
  const currentWeek = weekState.findIndex((w) => !w.complete);

  return (
    <div className="space-y-24">
      {/* ---------- setup: asymmetric 7/5, the hours numeral is the control's face ---------- */}
      <div className="no-print grid gap-6 lg:grid-cols-12">
        <section className="card space-y-5 p-6 sm:p-8 lg:col-span-7" aria-labelledby="p-job-h">
          <h2 id="p-job-h" className="text-xl font-semibold tracking-[-0.02em]">Which job are you preparing for?</h2>
          <JobPicker value={choice} onChange={setChoice} />
        </section>
        <section className="panel flex flex-col justify-between gap-6 p-6 sm:p-8 lg:col-span-5" aria-labelledby="p-time-h">
          <div className="flex items-start justify-between gap-4">
            <h2 id="p-time-h" className="text-xl font-semibold tracking-[-0.02em]">Your time</h2>
            <p aria-hidden className="numeral text-[6.5rem] leading-[0.8] text-stone">{hours}</p>
          </div>
          <div className="space-y-4">
            <label htmlFor="hours" className="label !mb-0">
              <span className="sr-only">Hours per week: {hours}</span>
              <span aria-hidden className="eyebrow">Hours per week</span>
            </label>
            <input id="hours" type="range" min={3} max={30} step={1} value={hours} onChange={(e) => setHours(Number(e.target.value))} className="block h-6 w-full cursor-pointer accent-stone" />
            <div aria-hidden className="flex justify-between text-[0.6875rem] font-medium text-stone-400"><span>3 h</span><span>30 h</span></div>
            <p className="muted">
              {hasProfile ? "Personalised to your resume and skill corrections." : <>No resume yet, so the plan starts from the basics. <Link href="/" className="font-medium text-royal underline underline-offset-2">Add your resume</Link>.</>}
            </p>
          </div>
        </section>
      </div>

      {!ref && <p className="muted -mt-12">Choose a job to build your prep kit.</p>}
      {ref && !fresh && <div className="-mt-12"><Spinner label="Building your prep kit…" /></div>}
      {fresh?.error && <div className="-mt-12"><ErrorBox message={fresh.error} /></div>}

      {kit && (
        <div className="space-y-16">
          {/* ---------- the kit: weeks and hours are the largest things; progress is the second ---------- */}
          <section aria-label="Your prep kit" className="surface-dark relative overflow-hidden">
            <div className="grid lg:grid-cols-12">
              <div className="flex flex-col justify-between gap-10 px-7 pt-9 sm:px-12 sm:pt-12 lg:col-span-7">
                <div className="space-y-3">
                  <p className="eyebrow flex items-center gap-2 text-stone-400"><span className="h-1.5 w-1.5 rounded-full bg-nitro" aria-hidden />Your prep kit</p>
                  <h2 className="text-3xl font-semibold leading-[1.05] tracking-[-0.03em] sm:text-4xl">
                    {kit.job_title ?? "Your target job"}
                    {kit.company && <span className="block font-extralight text-stone-400">{kit.company}</span>}
                  </h2>
                </div>
                <div className="flex items-end gap-6 sm:gap-10">
                  {/* Oversized weeks numeral, cropped by the block's bottom edge on purpose. */}
                  <p className="numeral -mb-[0.12em] text-[11rem] leading-[0.78] sm:text-[17rem]">{kit.schedule.length}</p>
                  <div className="space-y-5 pb-8 sm:pb-12">
                    <p className="text-3xl font-extralight tracking-[-0.03em] text-stone-400 sm:text-4xl">weeks</p>
                    <dl className="space-y-3">
                      <div><dt className="eyebrow text-stone-400">At</dt><dd className="numeral text-3xl leading-none sm:text-4xl">{kit.hours_per_week}<span className="ml-1 text-base font-light tracking-normal text-stone-400"> h/week</span></dd></div>
                      <div><dt className="eyebrow text-stone-400">In all</dt><dd className="numeral text-3xl leading-none sm:text-4xl">{Math.round(kit.total_hours)}<span className="ml-1 text-base font-light tracking-normal text-stone-400"> hours</span></dd></div>
                    </dl>
                  </div>
                </div>
              </div>
              <div className="space-y-6 border-t border-stone-700 px-7 py-9 sm:px-12 sm:py-12 lg:col-span-5 lg:border-l lg:border-t-0">
                <p className="eyebrow text-stone-400">Progress</p>
                <p className="numeral text-[7rem] leading-[0.85] sm:text-[9rem]">{progress}<span className="text-nitro">%</span></p>
                <div role="progressbar" aria-label="Prep progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="flex gap-1.5">
                  {weekState.map((w, i) => (
                    <span key={i} className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-stone-700">
                      <span className="block h-full rounded-full bg-whiteout transition-[width] duration-500" style={{ width: `${w.pct}%` }} />
                    </span>
                  ))}
                </div>
                <p className="text-[0.9375rem] font-light text-stone-400">
                  {doneCount} of {unique.length} items done. You&apos;re <span className="font-medium text-whiteout">{Math.round(kit.readiness)}% ready</span> for this job today.
                </p>
                <Link href={`/calendar?${new URLSearchParams({ new: "oa", title: `Online assessment: ${kit.job_title ?? "job"}`, company: kit.company ?? "" })}`} className="btn-ghost no-print">
                  Add OA date to calendar
                </Link>
              </div>
            </div>
          </section>

          {/* ---------- tabs ---------- */}
          <div className="space-y-12">
            <div className="no-print -mx-1 flex gap-1 overflow-x-auto border-b border-fusion px-1" role="tablist" aria-label="Prep kit sections">
              {TABS.map(([id, label], n) => (
                <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                  className={`-mb-px flex shrink-0 items-baseline gap-2 border-b-2 px-3 pb-3 pt-2 text-[0.9375rem] tracking-[-0.01em] transition ${tab === id ? "border-stone font-semibold text-stone" : "border-transparent font-medium text-stone-500 hover:text-stone"}`}>
                  <span aria-hidden className={`numeral text-[0.6875rem] ${tab === id ? "text-nitro" : "text-stone-400"}`}>{String(n + 1).padStart(2, "0")}</span>
                  {label}
                </button>
              ))}
            </div>

            {tab === "plan" && (
              <ol className="space-y-0">
                {kit.schedule.map((w, idx) => {
                  const st = weekState[idx];
                  const now = idx === currentWeek;
                  return (
                    <li key={w.week} className="relative grid gap-5 pb-14 last:pb-0 sm:grid-cols-12 sm:gap-0">
                      <div className="relative flex items-end justify-between gap-4 sm:col-span-3 sm:block sm:border-r sm:border-fusion sm:pr-10 sm:text-right">
                        <span aria-hidden className={`absolute -right-[7px] top-6 hidden h-3.5 w-3.5 rounded-full ring-4 ring-whiteout sm:block ${st.complete ? "bg-stone" : now ? "bg-nitro" : "bg-fusion"}`} />
                        <p aria-hidden className={`numeral text-6xl leading-none transition sm:text-7xl ${st.complete || now ? "text-stone" : "text-fusion"}`}>{String(w.week).padStart(2, "0")}</p>
                        <div className="sm:mt-3">
                          <h3 className="text-[0.9375rem] font-semibold tracking-[-0.01em]">Week {w.week}</h3>
                          <p className="muted">{w.hours} h · {st.done} of {st.total} done</p>
                          {now && !st.complete && <p className="eyebrow mt-2 text-nitro">{st.done === 0 && idx === 0 ? "Start here" : "Up next"}</p>}
                        </div>
                      </div>
                      <ul className="card divide-y divide-fusion-light sm:col-span-9 sm:ml-10">
                        {w.items.map((i) => (
                          <li key={i.kind + i.ref + i.title} className="px-5 py-4 text-[0.9375rem] sm:px-7">
                            <Check id={`${i.kind}:${i.ref}`} label={i.title} done={done} toggle={toggle}>
                              <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
                                <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                                  <span className={`chip uppercase tracking-[0.1em] ${KIND_STYLE[i.kind]}`}>{i.kind}</span>
                                  <span className="font-medium">{i.title}</span>
                                </span>
                                <span className="numeral text-sm font-medium tracking-normal text-stone-400">· {i.hours} h</span>
                              </span>
                            </Check>
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
                {kit.schedule.length === 0 && <li className="panel p-8 text-[0.9375rem] text-stone-600">Nothing to schedule: you already cover what this job asks for.</li>}
              </ol>
            )}

            {tab === "dsa" && (
              <section className="space-y-10">
                <TabIntro title="Data structures & algorithms">{kit.dsa.reason}</TabIntro>
                {kit.dsa.included && (
                  <>
                    <ol className="space-y-5">
                      {kit.dsa.topics.map((t, i) => (
                        <li key={t.id} className="card grid gap-6 p-6 sm:p-8 lg:grid-cols-12">
                          <div className="space-y-3 lg:col-span-4">
                            <p aria-hidden className="numeral text-6xl leading-none text-fusion">{String(i + 1).padStart(2, "0")}</p>
                            <Check id={`dsa:${t.id}`} label={t.name} done={done} toggle={toggle}>
                              <span className="text-xl font-semibold tracking-[-0.02em]"><span className="sr-only">{i + 1}. </span>{t.name}</span>
                            </Check>
                            <p className="muted pl-9">{t.hours} h{t.review ? " · quick review" : ""}</p>
                          </div>
                          <div className="grid gap-6 sm:grid-cols-2 lg:col-span-8">
                            <div className="space-y-3">
                              <p className="eyebrow">Patterns to know</p>
                              <Bullets items={t.patterns} />
                            </div>
                            <div className="space-y-3">
                              <p className="eyebrow">Can you do these?</p>
                              <Bullets items={t.checklist} />
                            </div>
                          </div>
                        </li>
                      ))}
                    </ol>
                    {kit.dsa.resources.length > 0 && (
                      <div className="panel p-6 sm:p-8"><ResourceList resources={kit.dsa.resources} skill="DSA" /></div>
                    )}
                  </>
                )}
              </section>
            )}

            {tab === "core" && (
              <section className="space-y-10">
                <TabIntro title="Core subjects">
                  {kit.core.length === 0 ? "This posting doesn't ask for CS core subjects." : "The subjects this posting asks for, with the level it wants and where you are today."}
                </TabIntro>
                <div className="space-y-5">
                  {kit.core.map((c) => (
                    <div key={c.skill_id} className="card space-y-5 p-6 sm:p-8">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <Check id={`core:${c.skill_id}`} label={c.name} done={done} toggle={toggle}>
                          <span className="text-xl font-semibold tracking-[-0.02em]">{c.name}</span>
                        </Check>
                        {c.status && <StatusChip status={c.status} />}
                        <span className="muted">asks {levelName(c.required_level)}, you&apos;re {levelName(c.candidate_level)} · <span className="font-medium text-stone-700">{c.hours} h</span></span>
                      </div>
                      <div className="pl-9"><Bullets items={c.topics} className="grid gap-x-8 md:grid-cols-2" /></div>
                      {c.resources.length > 0 && <div className="rounded-2xl bg-fusion-50 p-4 sm:ml-9 sm:p-5"><ResourceList resources={c.resources} skill={c.name} /></div>}
                    </div>
                  ))}
                </div>
                <div className="panel space-y-6 p-6 sm:p-8">
                  <div className="grid gap-2 lg:grid-cols-12 lg:items-end">
                    <h3 className="text-xl font-semibold tracking-[-0.02em] lg:col-span-4">Aptitude</h3>
                    <p className="muted max-w-xl lg:col-span-8">{kit.aptitude_note}</p>
                  </div>
                  <div className="grid gap-5 md:grid-cols-3">
                    {kit.aptitude.map((a) => (
                      <div key={a.area} className="space-y-3 rounded-2xl bg-white p-5 ring-1 ring-fusion-light">
                        <Check id={`aptitude:${a.area}`} label={a.area} done={done} toggle={toggle}>
                          <span className="font-semibold">{a.area}</span> <span className="muted">· {a.hours} h</span>
                        </Check>
                        <div className="pl-9"><Bullets items={a.topics} /></div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {tab === "oa" && (
              <section className="space-y-10">
                <TabIntro title="Online assessment">
                  Common formats for early-career tech roles. The ones this posting points to come first. Formats vary by company; check your test invite.
                </TabIntro>
                {kit.posting_process.length > 0 && (
                  <div className="panel space-y-4 p-6 sm:p-8">
                    <h3 className="eyebrow">What this posting says about the process</h3>
                    <ul className="space-y-3">
                      {kit.posting_process.map((l) => <li key={l} className="text-lg font-light leading-snug tracking-[-0.01em] text-stone-700">&ldquo;{l}&rdquo;</li>)}
                    </ul>
                  </div>
                )}
                <div className="grid gap-5 md:grid-cols-2">
                  {kit.oa_formats.map((f) => (
                    <div key={f.id} className={`card space-y-3 p-6 sm:p-8 ${f.relevant ? "ring-2 ring-royal" : ""}`}>
                      {f.reason && <p className="eyebrow text-royal">{f.reason}</p>}
                      <h3 className="text-xl font-semibold tracking-[-0.02em]">{f.name}</h3>
                      <p className="text-[0.9375rem] text-stone-600">{f.what}</p>
                      <Bullets items={f.prepare} className="pt-1" />
                    </div>
                  ))}
                </div>
              </section>
            )}

            {tab === "questions" && (
              <section className="space-y-10">
                <TabIntro title="Interview questions" />
                <div className="grid gap-5 lg:grid-cols-2">
                  <div className="card space-y-6 p-6 sm:p-8">
                    <div className="space-y-2">
                      <h3 className="text-xl font-semibold tracking-[-0.02em]">About this job</h3>
                      <p className="muted">
                        Practice questions built from the posting itself. Each one shows the line it comes from. These aren&apos;t questions the company is known to ask.
                      </p>
                    </div>
                    <QuestionList questions={kit.company_questions} />
                  </div>
                  <div className="card space-y-6 p-6 sm:p-8">
                    <div className="space-y-2">
                      <h3 className="text-xl font-semibold tracking-[-0.02em]">Behavioral</h3>
                      <p className="muted">{kit.star_tip}</p>
                    </div>
                    <QuestionList questions={kit.behavioral} />
                  </div>
                </div>
              </section>
            )}

            {tab === "project" && (
              <section className="space-y-10">
                <TabIntro title="Build one project">
                  Projects chosen to close your gaps for this job. Build one, put it on your resume, and your gap report updates.
                </TabIntro>
                {kit.projects.length === 0 && <p className="muted">No project template fits this job yet.</p>}
                <div className="space-y-5">
                  {kit.projects.map((p, idx) => (
                    <div key={p.id} className={`card grid gap-8 p-6 sm:p-8 lg:grid-cols-12 ${idx === 0 ? "ring-2 ring-stone" : ""}`}>
                      <div className="space-y-4 lg:col-span-5">
                        {idx === 0 && <span className="chip bg-stone text-whiteout">Recommended</span>}
                        <h3 className="text-2xl font-semibold leading-tight tracking-[-0.03em]">{p.title}</h3>
                        <p className="numeral text-5xl leading-none">~{p.hours}<span className="ml-1 text-base font-light tracking-normal text-stone-400"> hours</span></p>
                        <p className="text-[0.9375rem] font-light text-stone-600">{p.pitch}</p>
                        <div className="flex flex-wrap gap-2">
                          {p.covers.map((c) => <span key={c} className="chip bg-redline-soft text-redline">closes {c}</span>)}
                          {p.builds_on.map((c) => <span key={c} className="chip bg-fusion-light text-stone-600">uses your {c}</span>)}
                        </div>
                      </div>
                      <div className="space-y-5 lg:col-span-7">
                        <p className="eyebrow">Milestones</p>
                        <ol className="space-y-4 text-[0.9375rem]">
                          {p.milestones.map((m, i) => (
                            <li key={m} className="border-t border-fusion-light pt-4 first:border-0 first:pt-0">
                              <Check id={`project:${p.id}:${i}`} label={m} done={done} toggle={toggle}>{i + 1}. {m}</Check>
                            </li>
                          ))}
                        </ol>
                        {p.stretch.length > 0 && <p className="muted rounded-2xl bg-fusion-50 p-4">Stretch: {p.stretch.join(" · ")}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function QuestionList({ questions }: { questions: PrepQuestion[] }) {
  return (
    <ul className="divide-y divide-fusion-light">
      {questions.map((q, i) => (
        <li key={i} className="space-y-2 py-4 first:pt-0 last:pb-0">
          <p className="text-[0.9375rem] leading-relaxed">
            <span className="chip mr-2 bg-fusion-light text-stone-600">{q.theme}</span>
            <span className="font-medium">{q.question}</span>
            {q.source === "ai" && <span className="chip ml-2 bg-royal-soft text-royal">AI · grounded in posting</span>}
          </p>
          {q.quote && <p className="muted border-l-2 border-fusion pl-3">Posting: &ldquo;{q.quote}&rdquo;</p>}
        </li>
      ))}
    </ul>
  );
}
