"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAccount } from "@/lib/account";
import { api, type JobFit } from "@/lib/api";
import { safeUrl } from "@/lib/calendar";
import { useProfile } from "@/lib/profile";
import type { JobPosting } from "@/lib/types";
import { ErrorBox, GapGlyph, Spinner } from "@/components/ui";

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
    <div className="space-y-8">
      <div className="card flex flex-wrap items-center gap-3 p-3 sm:p-4">
        <input aria-label="Search jobs" className="input min-w-60 flex-1 border-0 bg-whiteout ring-0 focus:bg-white focus:ring-2" placeholder="Search title, company or skill (e.g. React)" value={q} onChange={(e) => setQ(e.target.value)} />
        <input aria-label="Location" className="input w-full bg-whiteout ring-0 focus:bg-white focus:ring-2 sm:w-48" placeholder="City" value={location} onChange={(e) => setLocation(e.target.value)} />
      </div>
      {fits && (
        <label className="flex w-fit cursor-pointer items-center gap-3 text-[0.9375rem] font-medium">
          <input type="checkbox" className="h-4 w-4 accent-[var(--color-royal)]" checked={closestFirst} onChange={(e) => setClosestFirst(e.target.checked)} />
          <span>Closest first <span className="muted font-normal">(sorted by how ready you already are)</span></span>
        </label>
      )}
      {error && <ErrorBox message={error} />}
      {!jobs && !error && <Spinner label="Loading jobs…" />}
      {!hasProfile && !user && jobs && (
        <div className="surface-dark relative overflow-hidden px-7 py-10 sm:px-12">
          <GapGlyph className="pointer-events-none absolute -right-20 -top-10 w-[26rem] text-stone-800 opacity-80" />
          <div className="relative flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-md space-y-2">
              <p className="eyebrow text-stone-400">See your readiness</p>
              <p className="text-2xl font-semibold tracking-[-0.03em]">Add your resume and every job shows how close you are.</p>
            </div>
            <Link href="/" className="btn bg-whiteout text-stone hover:bg-white">Add my resume →</Link>
          </div>
        </div>
      )}
      {shown && (
        <ul className="divide-y divide-fusion border-y border-fusion">
          {shown.length === 0 && <li className="py-10 text-stone-600">No jobs match.</li>}
          {shown.map((j, idx) => {
            const fit = fits?.get(j.id);
            const pct = fit ? Math.round(fit.readiness) : null;
            const tone = pct === null ? "" : pct >= 70 ? "text-royal" : pct >= 40 ? "text-nitro" : "text-stone";
            const apply = safeUrl(j.apply_url);
            return (
            <li key={j.id} className="py-8 sm:py-10">
              <div className="grid gap-5 lg:grid-cols-12 lg:gap-8">
                <div className="lg:col-span-3">
                  {pct !== null ? (
                    <p data-testid="readiness-badge" className={`numeral text-7xl leading-none sm:text-8xl ${tone}`}>
                      {pct}<span className="text-[0.5em] align-top text-stone-400">%</span>
                      <span className="sr-only"> ready</span>
                    </p>
                  ) : (
                    <p aria-hidden className="numeral text-7xl leading-none text-fusion sm:text-8xl">{String(idx + 1).padStart(2, "0")}</p>
                  )}
                  {pct !== null && <p className="eyebrow mt-3" aria-hidden>Ready today</p>}
                </div>
                <div className="space-y-3 lg:col-span-9">
                  <div className="space-y-1.5">
                    <h2 className="text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">{j.title}</h2>
                    <p className="text-[0.9375rem] font-light text-stone-600">
                      <span className="font-medium text-stone">{j.company}</span> · {j.location}{j.experience ? ` · ${j.experience}` : ""}{j.employment_type ? ` · ${j.employment_type}` : ""}
                    </p>
                  </div>
                  {fit && fit.open_must.length > 0 && (
                    <p className="muted flex flex-wrap items-center gap-2">
                      <span className="eyebrow text-stone-400">Still open</span>
                      {fit.open_must.slice(0, 2).map((m) => <span key={m} className="chip bg-fusion-50 text-stone-700 ring-1 ring-fusion-light">{m}</span>)}
                    </p>
                  )}
                  {j.source === "sample" && <p className="muted"><span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-nitro align-middle" aria-hidden />Sample posting (fictional company) for demo purposes</p>}
                  <div className="flex flex-wrap items-center gap-2 pt-2">
                    <Link href={`/analyze?job=${encodeURIComponent(j.id)}`} className="btn-primary">Check my fit</Link>
                    <Link href={`/resume?job=${encodeURIComponent(j.id)}`} className="btn-ghost">Tune resume</Link>
                    <Link href={`/prep?job=${encodeURIComponent(j.id)}`} className="btn-ghost">Prep kit</Link>
                    <Link
                      href={`/calendar?${new URLSearchParams({ new: "application", title: j.title, company: j.company, job: j.id, ...(apply ? { url: apply } : {}) })}`}
                      className="btn-ghost"
                    >
                      Add to calendar
                    </Link>
                    {apply && <a href={apply} target="_blank" rel="noopener noreferrer" className="btn-ghost">Apply ↗</a>}
                    <button type="button" className="btn-quiet ml-auto" onClick={() => setOpen(open === j.id ? null : j.id)} aria-expanded={open === j.id}>
                      {open === j.id ? "Hide" : "Details"}
                    </button>
                  </div>
                </div>
              </div>
              {open === j.id && <pre className="panel mt-6 whitespace-pre-wrap p-6 font-sans text-[0.9375rem] font-light leading-relaxed text-stone-700 lg:ml-[25%]">{j.description}</pre>}
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
