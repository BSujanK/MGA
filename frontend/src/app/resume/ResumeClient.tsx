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
    <div className="space-y-6">
      <div className="no-print grid gap-6 lg:grid-cols-2">
        <section className="card space-y-3 p-5" aria-labelledby="r-resume-h">
          <h2 id="r-resume-h" className="font-semibold text-slate-900">1. Your resume</h2>
          {hasProfile && profile.resumeText && !editResume ? (
            <div className="space-y-2 text-sm text-slate-600">
              <p>Using your saved resume{profile.fileName ? ` (${profile.fileName})` : ""}.</p>
              <button type="button" className="btn-ghost" onClick={() => setEditResume(true)}>Change resume</button>
            </div>
          ) : (
            <ResumeInput compact onSaved={() => setEditResume(false)} />
          )}
        </section>
        <section className="card space-y-3 p-5" aria-labelledby="r-job-h">
          <h2 id="r-job-h" className="font-semibold text-slate-900">2. The job you&apos;re applying to</h2>
          <JobPicker value={choice} onChange={(c) => { setChoice(c); setStep("interview"); }} />
        </section>
      </div>

      {ready && (
        <>
          <div className="no-print flex gap-2 border-b border-slate-200" role="tablist" aria-label="Tuner steps">
            {([["interview", "3. Interview"], ["resume", "4. Tailored resume"]] as const).map(([s, label]) => (
              <button
                key={s} type="button" role="tab" aria-selected={step === s}
                disabled={s === "resume" && !current}
                onClick={() => setStep(s)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold disabled:opacity-40 ${step === s ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-600 hover:text-slate-900"}`}
              >
                {label}
              </button>
            ))}
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
        </>
      )}
      {!ready && (
        <p className="no-print text-sm text-slate-500">
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

  return (
    <div className="no-print grid gap-6 lg:grid-cols-[1fr_18rem]">
      <section className="card space-y-4 p-5" aria-labelledby="iv-h">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="iv-h" className="font-semibold text-slate-900">A few questions about your experience</h2>
          {resp && <span className="text-xs text-slate-500">{resp.done ? "Done" : `Question ${Math.min(resp.asked + 1, Math.max(resp.planned, resp.asked + 1))} · about ${resp.planned} total`}</span>}
        </div>
        <p className="text-sm text-slate-600">
          Answer in your own words. Say &quot;no&quot; if you haven&apos;t done something: that&apos;s useful too, and it goes to your learning plan, not your resume.
        </p>

        <ol className="space-y-3" aria-label="Conversation">
          {turns.map((t, i) => (
            <li key={t.question_id + i} className="space-y-1.5">
              <p className="max-w-[85%] rounded-2xl rounded-tl-sm bg-slate-100 px-3 py-2 text-sm text-slate-800">{t.question}</p>
              <p className={`ml-auto max-w-[85%] rounded-2xl rounded-tr-sm px-3 py-2 text-sm ${t.answer ? "bg-indigo-600 text-white" : "bg-slate-50 italic text-slate-500"}`}>
                {t.answer || "Skipped"}
              </p>
            </li>
          ))}
        </ol>

        {!fresh && <Spinner label="Thinking of the next question…" />}
        {fresh?.error && <ErrorBox message={fresh.error} />}
        {q && (
          <div className="space-y-2">
            <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-slate-100 px-3 py-2">
              {q.skill_name && (
                <p className="mb-1 flex items-center gap-2 text-xs font-semibold text-slate-500">
                  {q.skill_name} {q.status && <StatusChip status={q.status} />}
                </p>
              )}
              <p className="text-sm text-slate-900">{q.question}</p>
              <p className="mt-1 text-xs text-slate-500">{q.why}</p>
            </div>
            <label htmlFor="answer" className="sr-only">Your answer</label>
            <textarea
              id="answer" className="input text-sm" rows={3} value={answer} onChange={(e) => setAnswer(e.target.value)}
              placeholder="e.g. Yes: in my 3rd-year project I… The result was…"
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && answer.trim()) reply(answer); }}
            />
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary" disabled={!answer.trim()} onClick={() => reply(answer)}>Answer</button>
              <button type="button" className="btn-ghost" onClick={() => reply("No, not yet")}>Not yet</button>
              <button type="button" className="btn-ghost" onClick={() => reply("")}>Skip</button>
            </div>
          </div>
        )}
        {resp?.done && <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">That&apos;s everything. Build your tailored resume when you&apos;re ready.</p>}

        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          <button type="button" className="btn-primary" onClick={onBuild} disabled={building}>
            {building ? "Building…" : resp?.done ? "Build my tailored resume" : "Skip ahead: build resume now"}
          </button>
          {turns.length > 0 && (
            <>
              <button type="button" className="btn-ghost" onClick={() => setTurns(turns.slice(0, -1))}>Undo last answer</button>
              <button type="button" className="btn-ghost" onClick={() => setTurns([])}>Start over</button>
            </>
          )}
        </div>
      </section>

      <aside className="card h-fit space-y-3 p-5" aria-labelledby="found-h">
        <h2 id="found-h" className="font-semibold text-slate-900">What your answers show</h2>
        {resp?.findings.length ? (
          <ul className="space-y-2">
            {resp.findings.map((f) => (
              <li key={f.skill_id} className="text-sm">
                <span className="font-medium text-slate-900">{f.name}</span>
                <span className="text-slate-500"> · {levelName(f.level)}</span>
                <p className="line-clamp-2 text-xs text-slate-500">&ldquo;{f.evidence}&rdquo;</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">Nothing yet. Skills you mention in your answers appear here.</p>
        )}
        <p className="text-xs text-slate-500">
          Answers are saved in this browser only. To correct a level, use <Link href="/profile" className="underline">My skills</Link>.
        </p>
        {resp && <p className="text-xs text-slate-400">{resp.mode === "claude" ? "Questions worded by AI from your gap report" : "Questions from your gap report"}</p>}
      </aside>
    </div>
  );
}
