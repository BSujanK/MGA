"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useProfile } from "@/lib/profile";
import type { GapReport, JobPosting } from "@/lib/types";
import { ResumeInput } from "@/components/ResumeInput";
import { GapList, GapSummaryCard } from "@/components/GapReportView";
import { ErrorBox, Spinner } from "@/components/ui";

export function AnalyzeClient() {
  const params = useSearchParams();
  const { profile, hasProfile } = useProfile();
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [mode, setMode] = useState<"pick" | "paste">("pick");
  const [jobId, setJobId] = useState(params.get("job") ?? "");
  const [jobText, setJobText] = useState("");
  const [report, setReport] = useState<GapReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editResume, setEditResume] = useState(false);
  const { user } = useAccount();
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    api.jobs().then(setJobs).catch((e) => setError(e.message));
  }, []);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const body = {
        resume_text: profile.resumeText || undefined,
        overrides: profile.overrides,
        ...(mode === "pick" ? { job_id: jobId } : { job_text: jobText }),
      };
      setReport(await api.gap(body));
      setSaveState("idle");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveReport() {
    if (!report) return;
    setSaveState("saving");
    setSaveError(null);
    try {
      const savedJobId = mode === "pick" && jobId ? jobId : undefined;
      await api.saveReport({
        kind: "gap",
        title: [report.job.title || "Pasted posting", report.job.company].filter(Boolean).join(" · "),
        job_id: savedJobId,
        summary: { readiness: report.summary.readiness, must_have_coverage: report.summary.must_have_coverage },
        data: report,
      });
      setSaveState("saved");
    } catch (e) {
      setSaveError((e as Error).message);
      setSaveState("idle");
    }
  }

  const canRun = hasProfile && (mode === "pick" ? !!jobId : jobText.trim().length > 40);

  return (
    <div className="space-y-24">
      <div className="grid gap-6 lg:grid-cols-12">
        <section className="card space-y-4 p-6 sm:p-8 lg:col-span-5 lg:mt-12" aria-labelledby="resume-h">
          <p aria-hidden className="numeral text-[4.5rem] leading-[0.8] text-fusion">01</p>
          <h2 id="resume-h" className="text-xl font-semibold tracking-[-0.02em]">Your resume</h2>
          {hasProfile && !editResume ? (
            <div className="space-y-4 text-[0.9375rem] text-stone-600">
              <p>
                Using your saved resume{profile.fileName ? ` (${profile.fileName})` : ""}
                {profile.overrides.length ? ` plus ${profile.overrides.length} skill corrections` : ""}.
              </p>
              <button type="button" className="btn-ghost" onClick={() => setEditResume(true)}>Change resume</button>
            </div>
          ) : (
            <ResumeInput compact onSaved={() => setEditResume(false)} />
          )}
        </section>
        <section className="card space-y-5 p-6 sm:p-8 lg:col-span-7" aria-labelledby="job-h">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="space-y-4">
              <p aria-hidden className="numeral text-[4.5rem] leading-[0.8] text-fusion">02</p>
              <h2 id="job-h" className="text-xl font-semibold tracking-[-0.02em]">The job</h2>
            </div>
            <div className="flex rounded-full bg-fusion-50 p-1 ring-1 ring-fusion-light" role="tablist">
              {(["pick", "paste"] as const).map((m) => (
                <button
                  key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
                  className={`rounded-full px-4 py-1.5 text-[0.8125rem] font-medium transition ${mode === m ? "bg-white text-stone shadow-float" : "text-stone-500 hover:text-stone"}`}
                >
                  {m === "pick" ? "Pick a job" : "Paste a posting"}
                </button>
              ))}
            </div>
          </div>
          {mode === "pick" ? (
            <div>
              <label htmlFor="job" className="label">Job</label>
              <select id="job" className="input" value={jobId} onChange={(e) => setJobId(e.target.value)}>
                <option value="">Choose a job…</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>{j.title} · {j.company} · {j.location}</option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label htmlFor="jd" className="label">Job description</label>
              <textarea
                id="jd" className="input h-40 text-[0.8125rem]" value={jobText} onChange={(e) => setJobText(e.target.value)}
                placeholder="Paste the full posting: responsibilities, requirements, nice-to-haves."
              />
            </div>
          )}
          <button type="button" className="btn-primary w-full px-6 py-3.5 text-[0.9375rem]" disabled={!canRun || busy} onClick={run}>
            {busy ? "Analyzing…" : "Analyze my fit"}
          </button>
          {!hasProfile && <p className="muted">Add your resume first.</p>}
        </section>
      </div>
      {busy && <Spinner label="Comparing every skill…" />}
      {error && <ErrorBox message={error} />}
      {report && !busy && (
        <div className="space-y-12">
          <GapSummaryCard report={report} />
          {user && (
            <div className="flex flex-wrap items-center gap-3">
              {saveState === "saved" ? (
                <p className="text-sm text-royal" role="status">
                  Saved. <Link href="/account" className="font-medium underline">View in your account</Link>
                </p>
              ) : (
                <button type="button" className="btn-ghost" onClick={saveReport} disabled={saveState === "saving"}>
                  {saveState === "saving" ? "Saving…" : "Save report"}
                </button>
              )}
              {saveError && <span className="text-sm text-redline">{saveError}</span>}
            </div>
          )}
          <GapList gaps={report.gaps} />
          {report.extra_skills.length > 0 && (
            <section className="panel space-y-5 p-6 sm:p-8" aria-labelledby="extra-h">
              <div className="space-y-1">
                <h2 id="extra-h" className="text-xl font-semibold tracking-[-0.02em]">Your other skills</h2>
                <p className="muted">This job doesn&apos;t ask for these, but they still count elsewhere.</p>
              </div>
              <ul className="flex flex-wrap gap-2">
                {report.extra_skills.map((s) => (
                  <li key={s.skill_id} className="chip bg-white px-3 py-1.5 text-[0.8125rem] font-medium text-stone-700 ring-1 ring-fusion">{s.name}</li>
                ))}
              </ul>
            </section>
          )}
          {report.job.unmapped.length > 0 && (
            <p className="muted">Also mentioned, not yet in our skill map: {report.job.unmapped.join(", ")}.</p>
          )}
        </div>
      )}
    </div>
  );
}
