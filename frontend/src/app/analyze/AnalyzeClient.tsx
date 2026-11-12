"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
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
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const canRun = hasProfile && (mode === "pick" ? !!jobId : jobText.trim().length > 40);

  return (
    <div className="space-y-8">
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card space-y-3 p-5" aria-labelledby="resume-h">
          <h2 id="resume-h" className="font-semibold text-slate-900">1. Your resume</h2>
          {hasProfile && !editResume ? (
            <div className="space-y-2 text-sm text-slate-600">
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
        <section className="card space-y-3 p-5" aria-labelledby="job-h">
          <div className="flex items-center justify-between">
            <h2 id="job-h" className="font-semibold text-slate-900">2. The job</h2>
            <div className="flex rounded-lg bg-slate-100 p-0.5 text-sm" role="tablist">
              {(["pick", "paste"] as const).map((m) => (
                <button
                  key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
                  className={`rounded-md px-3 py-1 font-medium ${mode === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
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
                id="jd" className="input h-40 text-xs" value={jobText} onChange={(e) => setJobText(e.target.value)}
                placeholder="Paste the full posting: responsibilities, requirements, nice-to-haves."
              />
            </div>
          )}
          <button type="button" className="btn-primary w-full" disabled={!canRun || busy} onClick={run}>
            {busy ? "Analyzing…" : "Analyze my fit"}
          </button>
          {!hasProfile && <p className="text-xs text-slate-500">Add your resume first.</p>}
        </section>
      </div>
      {busy && <Spinner label="Comparing every skill…" />}
      {error && <ErrorBox message={error} />}
      {report && !busy && (
        <div className="space-y-8">
          <GapSummaryCard report={report} />
          <GapList gaps={report.gaps} />
          {report.extra_skills.length > 0 && (
            <section className="card p-5" aria-labelledby="extra-h">
              <h2 id="extra-h" className="mb-2 font-semibold text-slate-900">Your other skills</h2>
              <p className="mb-3 text-sm text-slate-600">This job doesn&apos;t ask for these, but they still count elsewhere.</p>
              <ul className="flex flex-wrap gap-2">
                {report.extra_skills.map((s) => (
                  <li key={s.skill_id} className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700">{s.name}</li>
                ))}
              </ul>
            </section>
          )}
          {report.job.unmapped.length > 0 && (
            <p className="text-xs text-slate-500">Also mentioned, not yet in our skill map: {report.job.unmapped.join(", ")}.</p>
          )}
        </div>
      )}
    </div>
  );
}
