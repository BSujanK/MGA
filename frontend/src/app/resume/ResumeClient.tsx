"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { useProfile } from "@/lib/profile";
import { useTurns } from "@/lib/tuner";
import type { ChatResponse, ChatTurn, JobRef, TailoredResume } from "@/lib/types";
import { JobPicker, jobKey, jobRef, type JobChoice } from "@/components/JobPicker";
import { ResumeInput } from "@/components/ResumeInput";
import { TailoredResumeView } from "@/components/TailoredResumeView";
import { ErrorBox, Spinner, StatusChip, levelName } from "@/components/ui";

/** A big faded index numeral cropped by the card edge. */
function Index({ n }: { n: string }) {
  return (
    <span aria-hidden className="numeral pointer-events-none absolute -right-3 -top-7 select-none text-[8rem] font-extralight leading-none text-fusion-light">
      {n}
    </span>
  );
}

export function ResumeClient() {
  const params = useSearchParams();
  const { profile, hasProfile } = useProfile();
  const [choice, setChoice] = useState<JobChoice>({ mode: "pick", jobId: params.get("job") ?? "", jobText: "" });
  const [step, setStep] = useState<"interview" | "resume">("interview");
  const [doc, setDoc] = useState<{ key: string; value: TailoredResume } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editResume, setEditResume] = useState(false);

  const ref = jobRef(choice);
  const key = jobKey(choice);
  const { turns, setTurns } = useTurns(key);
  const ready = hasProfile && profile.resumeText.trim().length > 0 && !!ref;

  async function build() {
    if (!ref || !key) return;
    setBusy(true);
    setError(null);
    try {
      const value = await api.resumeTailor({ ...ref, resume_text: profile.resumeText, overrides: profile.overrides, turns });
      setDoc({ key, value });
      setStep("resume");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const current = doc && doc.key === key ? doc.value : null;

  return (
    <div className="space-y-16">
      <div className="no-print grid gap-6 lg:grid-cols-2">
        <section className="card relative space-y-4 overflow-hidden p-6 sm:p-8" aria-labelledby="r-resume-h">
          <Index n="01" />
          <h2 id="r-resume-h" className="relative text-xl font-semibold tracking-[-0.02em]">Your resume</h2>
          {hasProfile && profile.resumeText && !editResume ? (
            <div className="relative space-y-4">
              <p className="muted">Using your saved resume{profile.fileName ? ` (${profile.fileName})` : ""}.</p>
              <button type="button" className="btn-ghost" onClick={() => setEditResume(true)}>Change resume</button>
            </div>
          ) : (
            <div className="relative"><ResumeInput compact onSaved={() => setEditResume(false)} /></div>
          )}
        </section>
        <section className="card relative space-y-4 overflow-hidden p-6 sm:p-8" aria-labelledby="r-job-h">
          <Index n="02" />
          <h2 id="r-job-h" className="relative text-xl font-semibold tracking-[-0.02em]">The job you&apos;re applying to</h2>
          <div className="relative"><JobPicker value={choice} onChange={(c) => { setChoice(c); setStep("interview"); }} /></div>
        </section>
      </div>

      {ready && (
        <div className="space-y-12">
          <div className="no-print flex justify-center">
            <div className="inline-flex gap-1 rounded-full bg-fusion-light p-1" role="tablist" aria-label="Tuner steps">
              {([["interview", "3. Interview"], ["resume", "4. Tailored resume"]] as const).map(([s, label]) => (
                <button
                  key={s} type="button" role="tab" aria-selected={step === s}
                  disabled={s === "resume" && !current}
                  onClick={() => setStep(s)}
                  className={`rounded-full px-5 py-2 text-sm font-medium tracking-[-0.01em] transition disabled:cursor-not-allowed disabled:opacity-40 ${step === s ? "bg-white text-stone shadow-float" : "text-stone-500 hover:text-stone"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {step === "interview" ? (
            <Interview
              jobRef={ref!} resumeText={profile.resumeText} overrides={profile.overrides}
              turns={turns} setTurns={setTurns} onBuild={build} building={busy}
            />
          ) : current ? (
            <TailoredResumeView
              doc={current}
              update={(fn) => setDoc((d) => (d ? { ...d, value: fn(d.value) } : d))}
              learnHref={ref?.job_id ? `/analyze?job=${encodeURIComponent(ref.job_id)}` : "/analyze"}
            />
          ) : null}
          {error && <ErrorBox message={error} />}
        </div>
      )}
      {!ready && (
        <p className="no-print text-center text-[0.9375rem] font-light text-stone-500">
          {hasProfile && profile.resumeText ? "Choose a job to start." : "Add your resume and choose a job to start."}
        </p>
      )}
    </div>
  );
}

function Interview({ jobRef: ref, resumeText, overrides, turns, setTurns, onBuild, building }: {
  jobRef: JobRef; resumeText: string; overrides: { skill_id: string; level: number }[];
  turns: ChatTurn[]; setTurns: (t: ChatTurn[]) => void; onBuild: () => void; building: boolean;
}) {
  const [answer, setAnswer] = useState("");
  const reqKey = useMemo(() => JSON.stringify({ ref, turns, n: resumeText.length, o: overrides }), [ref, turns, resumeText, overrides]);
  const [result, setResult] = useState<{ key: string; resp: ChatResponse | null; error: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.resumeChat({ ...ref, resume_text: resumeText, overrides, turns })
      .then((resp) => !cancelled && setResult({ key: reqKey, resp, error: null }))
      .catch((e) => !cancelled && setResult({ key: reqKey, resp: null, error: e.message }));
    return () => { cancelled = true; };
    // reqKey captures every input
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqKey]);

  const fresh = result?.key === reqKey ? result : null;
  const resp = fresh?.resp ?? null;
  const q = resp?.question ?? null;

  function reply(text: string) {
    if (!q) return;
    setTurns([...turns, { question_id: q.id, skill_id: q.skill_id ?? null, question: q.question, answer: text.trim() }]);
    setAnswer("");
  }

  const progress = resp ? (resp.done ? 100 : Math.min(100, (resp.asked / Math.max(resp.planned, 1)) * 100)) : 0;

  return (
    <div className="no-print grid gap-12 lg:grid-cols-12 lg:gap-14">
      <section className="space-y-10 lg:col-span-7" aria-labelledby="iv-h">
        <div className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="iv-h" className="title">A few questions <span className="font-extralight text-stone-400">about your experience</span></h2>
            {resp && <span className="eyebrow">{resp.done ? "Done" : `Question ${Math.min(resp.asked + 1, Math.max(resp.planned, resp.asked + 1))} · about ${resp.planned} total`}</span>}
          </div>
          <div className="h-0.5 w-full overflow-hidden rounded-full bg-fusion-light" aria-hidden>
            <div className="h-full rounded-full bg-stone transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
          <p className="muted max-w-xl">
            Answer in your own words. Say &quot;no&quot; if you haven&apos;t done something: that&apos;s useful too, and it goes to your learning plan, not your resume.
          </p>
        </div>

        {turns.length > 0 && (
          <ol className="space-y-5" aria-label="Conversation">
            {turns.map((t, i) => (
              <li key={t.question_id + i} className="space-y-2">
                <p className="max-w-[80%] rounded-3xl rounded-tl-md bg-fusion-light px-4 py-2.5 text-[0.9375rem] text-stone-700">{t.question}</p>
                <p className={`ml-auto max-w-[80%] rounded-3xl rounded-tr-md px-4 py-2.5 text-[0.9375rem] ${t.answer ? "bg-stone text-whiteout" : "bg-fusion-50 italic text-stone-500 ring-1 ring-fusion-light"}`}>
                  {t.answer || "Skipped"}
                </p>
              </li>
            ))}
          </ol>
        )}

        {!fresh && <Spinner label="Thinking of the next question…" />}
        {fresh?.error && <ErrorBox message={fresh.error} />}
        {q && (
          <div className="space-y-6">
            <div className="space-y-3">
              {q.skill_name && (
                <p className="eyebrow flex items-center gap-3">
                  <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-nitro" aria-hidden />{q.skill_name}</span>
                  {q.status && <StatusChip status={q.status} />}
                </p>
              )}
              <p className="text-3xl font-semibold leading-[1.1] tracking-[-0.03em] sm:text-4xl">{q.question}</p>
              <p className="muted max-w-xl font-light">{q.why}</p>
            </div>
            <div className="space-y-3">
              <label htmlFor="answer" className="sr-only">Your answer</label>
              <textarea
                id="answer" className="input" rows={4} value={answer} onChange={(e) => setAnswer(e.target.value)}
                placeholder="e.g. Yes: in my 3rd-year project I… The result was…"
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && answer.trim()) reply(answer); }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="btn-primary px-6" disabled={!answer.trim()} onClick={() => reply(answer)}>Answer</button>
                <button type="button" className="btn-ghost" onClick={() => reply("No, not yet")}>Not yet</button>
                <button type="button" className="btn-quiet" onClick={() => reply("")}>Skip</button>
              </div>
            </div>
          </div>
        )}
        {resp?.done && <p className="rounded-2xl bg-royal-soft px-5 py-4 text-[0.9375rem] text-royal">That&apos;s everything. Build your tailored resume when you&apos;re ready.</p>}

        <div className="flex flex-wrap items-center gap-2 border-t border-fusion pt-6">
          <button type="button" className={resp?.done ? "btn-accent px-6 py-3" : "btn-ghost"} onClick={onBuild} disabled={building}>
            {building ? "Building…" : resp?.done ? "Build my tailored resume" : "Skip ahead: build resume now"}
          </button>
          {turns.length > 0 && (
            <>
              <button type="button" className="btn-quiet" onClick={() => setTurns(turns.slice(0, -1))}>Undo last answer</button>
              <button type="button" className="btn-quiet" onClick={() => setTurns([])}>Start over</button>
            </>
          )}
        </div>
      </section>

      <aside className="panel h-fit space-y-5 p-6 sm:p-8 lg:sticky lg:top-24 lg:col-span-5 lg:mt-24" aria-labelledby="found-h">
        <div className="space-y-1">
          <p className="numeral text-7xl leading-none text-stone">{resp?.findings.length ?? 0}</p>
          <h2 id="found-h" className="eyebrow">What your answers show</h2>
        </div>
        {resp?.findings.length ? (
          <ul className="divide-y divide-fusion">
            {resp.findings.map((f) => (
              <li key={f.skill_id} className="space-y-1 py-3 first:pt-0">
                <p className="text-[0.9375rem]"><span className="font-semibold">{f.name}</span><span className="text-stone-500"> · {levelName(f.level)}</span></p>
                <p className="muted line-clamp-2 font-light">&ldquo;{f.evidence}&rdquo;</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted font-light">Nothing yet. Skills you mention in your answers appear here.</p>
        )}
        <p className="muted">
          Answers are saved in this browser only. To correct a level, use <Link href="/profile" className="text-royal underline underline-offset-2">My skills</Link>.
        </p>
        {resp && <p className="muted">{resp.mode === "claude" ? "Questions worded by AI from your gap report" : "Questions from your gap report"}</p>}
      </aside>
    </div>
  );
}
