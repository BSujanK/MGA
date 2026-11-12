"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAccount } from "@/lib/account";
import { api, type JobFit } from "@/lib/api";
import { safeUrl } from "@/lib/calendar";
import { useProfile } from "@/lib/profile";
import type { JobPosting } from "@/lib/types";
import { ErrorBox, Spinner } from "@/components/ui";

export function JobsClient() {
  const [q, setQ] = useState("");
  const [location, setLocation] = useState("");
  const [jobs, setJobs] = useState<JobPosting[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { profile, hasProfile } = useProfile();
  const { user } = useAccount();
  const [fitData, setFits] = useState<Map<string, JobFit> | null>(null);
  const [closestFirst, setClosestFirst] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => {
      api.jobs({ q, location }).then(setJobs).catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [q, location]);

  // Readiness per job. Needs a resume: the local one, or the one saved to the account.
  const fits = hasProfile || user ? fitData : null;
  const resumeText = profile.resumeText;
  const overrides = profile.overrides;
  const userId = user?.id;
  useEffect(() => {
    if (!hasProfile && !userId) return;
    let live = true;
    const t = setTimeout(() => {
      api
        .jobFit({ resume_text: resumeText || undefined, overrides: resumeText ? overrides : overrides.length ? overrides : undefined, q, location, limit: 100 })
        .then((r) => live && setFits(new Map(r.jobs.map((f) => [f.job.id, f]))))
        .catch(() => live && setFits(null)); // fit is a bonus: never break the list
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [hasProfile, userId, resumeText, overrides, q, location]);

  const shown = useMemo(() => {
    if (!jobs || !fits || !closestFirst) return jobs;
    const rank = (j: JobPosting) => fits.get(j.id)?.readiness ?? -1;
    return [...jobs].sort((a, b) => rank(b) - rank(a));
  }, [jobs, fits, closestFirst]);

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap gap-3 p-4">
        <input aria-label="Search jobs" className="input min-w-60 flex-1" placeholder="Search title, company or skill (e.g. React)" value={q} onChange={(e) => setQ(e.target.value)} />
        <input aria-label="Location" className="input w-48" placeholder="City" value={location} onChange={(e) => setLocation(e.target.value)} />
      </div>
      {fits && (
        <label className="flex w-fit items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" className="h-4 w-4" checked={closestFirst} onChange={(e) => setClosestFirst(e.target.checked)} />
          Closest first <span className="text-slate-500">(sorted by how ready you already are)</span>
        </label>
      )}
      {error && <ErrorBox message={error} />}
      {!jobs && !error && <Spinner label="Loading jobs…" />}
      {shown && (
        <ul className="space-y-3">
          {shown.length === 0 && <li className="text-slate-600">No jobs match.</li>}
          {shown.map((j) => {
            const fit = fits?.get(j.id);
            return (
            <li key={j.id} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-900">{j.title}</h2>
                  <p className="text-sm text-slate-600">{j.company} · {j.location}{j.experience ? ` · ${j.experience}` : ""}{j.employment_type ? ` · ${j.employment_type}` : ""}</p>
                  {fit && (
                    <p className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <span
                        data-testid="readiness-badge"
                        className={`rounded-full px-2.5 py-0.5 font-semibold ring-1 ring-inset ${fit.readiness >= 70 ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : fit.readiness >= 40 ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-slate-100 text-slate-700 ring-slate-200"}`}
                      >
                        {Math.round(fit.readiness)}% ready
                      </span>
                      {fit.open_must.length > 0 && (
                        <span className="text-slate-600">Still open: {fit.open_must.slice(0, 2).join(", ")}</span>
                      )}
                    </p>
                  )}
                  {j.source === "sample" && <p className="mt-1 text-xs text-amber-700">Sample posting (fictional company) for demo purposes</p>}
                </div>
                <div className="flex gap-2">
                  <button type="button" className="btn-ghost" onClick={() => setOpen(open === j.id ? null : j.id)} aria-expanded={open === j.id}>
                    {open === j.id ? "Hide" : "Details"}
                  </button>
                  <Link href={`/analyze?job=${encodeURIComponent(j.id)}`} className="btn-primary">Check my fit</Link>
                  <Link href={`/resume?job=${encodeURIComponent(j.id)}`} className="btn-ghost">Tune resume</Link>
                  <Link href={`/prep?job=${encodeURIComponent(j.id)}`} className="btn-ghost">Prep kit</Link>
                  <Link
                    href={`/calendar?${new URLSearchParams({ new: "application", title: j.title, company: j.company, job: j.id, ...(safeUrl(j.apply_url) ? { url: safeUrl(j.apply_url)! } : {}) })}`}
                    className="btn-ghost"
                  >
                    Add to calendar
                  </Link>
                  {safeUrl(j.apply_url) && <a href={safeUrl(j.apply_url)} target="_blank" rel="noopener noreferrer" className="btn-ghost">Apply ↗</a>}
                </div>
              </div>
              {open === j.id && <pre className="mt-4 whitespace-pre-wrap rounded-xl bg-slate-50 p-4 font-sans text-sm text-slate-700">{j.description}</pre>}
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
