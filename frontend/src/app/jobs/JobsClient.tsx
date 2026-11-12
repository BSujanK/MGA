"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { JobPosting } from "@/lib/types";
import { ErrorBox, Spinner } from "@/components/ui";

export function JobsClient() {
  const [q, setQ] = useState("");
  const [location, setLocation] = useState("");
  const [jobs, setJobs] = useState<JobPosting[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api.jobs({ q, location }).then(setJobs).catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [q, location]);

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap gap-3 p-4">
        <input aria-label="Search jobs" className="input min-w-60 flex-1" placeholder="Search title, company or skill (e.g. React)" value={q} onChange={(e) => setQ(e.target.value)} />
        <input aria-label="Location" className="input w-48" placeholder="City" value={location} onChange={(e) => setLocation(e.target.value)} />
      </div>
      {error && <ErrorBox message={error} />}
      {!jobs && !error && <Spinner label="Loading jobs…" />}
      {jobs && (
        <ul className="space-y-3">
          {jobs.length === 0 && <li className="text-slate-600">No jobs match.</li>}
          {jobs.map((j) => (
            <li key={j.id} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-900">{j.title}</h2>
                  <p className="text-sm text-slate-600">{j.company} · {j.location}{j.experience ? ` · ${j.experience}` : ""}{j.employment_type ? ` · ${j.employment_type}` : ""}</p>
                  {j.source === "sample" && <p className="mt-1 text-xs text-amber-700">Sample posting (fictional company) for demo purposes</p>}
                </div>
                <div className="flex gap-2">
                  <button type="button" className="btn-ghost" onClick={() => setOpen(open === j.id ? null : j.id)} aria-expanded={open === j.id}>
                    {open === j.id ? "Hide" : "Details"}
                  </button>
                  <Link href={`/analyze?job=${encodeURIComponent(j.id)}`} className="btn-primary">Check my fit</Link>
                  <Link href={`/resume?job=${encodeURIComponent(j.id)}`} className="btn-ghost">Tune resume</Link>
                  {j.apply_url && <a href={j.apply_url} target="_blank" rel="noopener noreferrer" className="btn-ghost">Apply ↗</a>}
                </div>
              </div>
              {open === j.id && <pre className="mt-4 whitespace-pre-wrap rounded-xl bg-slate-50 p-4 font-sans text-sm text-slate-700">{j.description}</pre>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
