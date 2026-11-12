"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { textKey } from "@/lib/store";
import type { JobPosting, JobRef } from "@/lib/types";

export interface JobChoice {
  mode: "pick" | "paste";
  jobId: string;
  jobText: string;
}

/** The request fields for a choice, or null if it is incomplete. */
export function jobRef(c: JobChoice): JobRef | null {
  if (c.mode === "pick") return c.jobId ? { job_id: c.jobId } : null;
  return c.jobText.trim().length > 40 ? { job_text: c.jobText } : null;
}

/** Stable key for storing per-job data (answers, prep progress). */
export function jobKey(c: JobChoice): string | null {
  const ref = jobRef(c);
  if (!ref) return null;
  return ref.job_id ? `job:${ref.job_id}` : textKey(ref.job_text!);
}

/** Pick one of the stored postings or paste any job description. */
export function JobPicker({ value, onChange, onJobs }: {
  value: JobChoice;
  onChange: (c: JobChoice) => void;
  onJobs?: (jobs: JobPosting[]) => void;
}) {
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.jobs().then((j) => { setJobs(j); onJobs?.(j); }).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex rounded-full bg-fusion-50 p-1 text-sm ring-1 ring-fusion-light" role="tablist" aria-label="How to choose the job">
        {(["pick", "paste"] as const).map((m) => (
          <button
            key={m} type="button" role="tab" aria-selected={value.mode === m} onClick={() => onChange({ ...value, mode: m })}
            className={`flex-1 rounded-full px-4 py-1.5 font-medium transition ${value.mode === m ? "bg-white text-stone shadow-sm" : "text-stone-600 hover:text-stone"}`}
          >
            {m === "pick" ? "Pick a job" : "Paste a posting"}
          </button>
        ))}
      </div>
      {value.mode === "pick" ? (
        <div>
          <label htmlFor="job-pick" className="label">Job</label>
          <select id="job-pick" className="input" value={value.jobId} onChange={(e) => onChange({ ...value, jobId: e.target.value })}>
            <option value="">Choose a job…</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>{j.title} · {j.company} · {j.location}</option>
            ))}
          </select>
          {error && <p className="mt-1 text-xs text-redline">{error}</p>}
        </div>
      ) : (
        <div>
          <label htmlFor="job-text" className="label">Job description</label>
          <textarea
            id="job-text" className="input h-40 text-[0.9375rem] font-light leading-relaxed" value={value.jobText}
            onChange={(e) => onChange({ ...value, jobText: e.target.value })}
            placeholder="Paste the full posting: responsibilities, requirements, nice-to-haves."
          />
        </div>
      )}
    </div>
  );
}
