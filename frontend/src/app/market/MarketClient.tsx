"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useProfile } from "@/lib/profile";
import type { MarketReport } from "@/lib/types";
import { GapCard } from "@/components/GapReportView";
import { DemandChart } from "@/components/market/DemandChart";
import { ErrorBox, Spinner } from "@/components/ui";

const ROLES = [
  { value: "sde", label: "Software engineer (SDE)" },
  { value: "frontend", label: "Frontend" },
  { value: "full stack", label: "Full stack" },
  { value: "backend", label: "Backend" },
  { value: "data analyst", label: "Data analyst" },
  { value: "data engineer", label: "Data engineer" },
  { value: "ml", label: "ML / AI engineer" },
  { value: "devops", label: "DevOps / Cloud" },
  { value: "qa", label: "QA / Test automation" },
  { value: "mobile", label: "Mobile" },
];
const CITIES = ["", "Bengaluru", "Hyderabad", "Pune", "Chennai", "Gurugram", "Remote"];

export function MarketClient() {
  const { profile, hasProfile } = useProfile();
  const [role, setRole] = useState("sde");
  const [city, setCity] = useState("");
  const [report, setReport] = useState<MarketReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setReport(await api.market({
        role, location: city || undefined, top: 20,
        resume_text: profile.resumeText || undefined, overrides: profile.overrides,
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-24">
      <form className="card flex flex-wrap items-end gap-4 p-6 sm:p-8" onSubmit={(e) => { e.preventDefault(); run(); }}>
        <div className="min-w-56 flex-1">
          <label htmlFor="role" className="label">Role</label>
          <select id="role" className="input" value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div className="min-w-44 flex-1 sm:flex-none">
          <label htmlFor="city" className="label">Location</label>
          <select id="city" className="input" value={city} onChange={(e) => setCity(e.target.value)}>
            {CITIES.map((c) => <option key={c} value={c}>{c || "Anywhere in India"}</option>)}
          </select>
        </div>
        <button className="btn-primary w-full px-6 py-3.5 text-[0.9375rem] sm:w-auto" disabled={busy}>{busy ? "Analyzing…" : "Analyze market"}</button>
        {!hasProfile && <p className="muted w-full">Add your resume on the home page to see your personal gaps against the market.</p>}
      </form>
      {busy && <Spinner label="Reading every posting…" />}
      {error && <ErrorBox message={error} />}
      {report && !busy && (report.postings_analyzed === 0 ? (
        <p className="lede">No postings for this role and location yet. Try another city or “Anywhere”.</p>
      ) : (
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-8">
          <DemandChart report={report} className="lg:col-span-7" />
          <section className="space-y-6 lg:col-span-5 lg:mt-24" aria-labelledby="you-h">
            <h2 id="you-h" className="title">
              You vs. this market
              <span className="block font-extralight text-stone-400">Your gaps, in order.</span>
            </h2>
            {report.market_readiness != null ? (
              <>
                <div className="card space-y-3 p-6 sm:p-8">
                  <div role="img" aria-label={`Market readiness: ${Math.round(report.market_readiness)}%`}>
                    <p aria-hidden className="numeral text-[7rem] leading-[0.85] sm:text-[9rem]">
                      {Math.round(report.market_readiness)}<span className="text-nitro">%</span>
                    </p>
                    <p aria-hidden className="eyebrow mt-4">Market readiness</p>
                  </div>
                  <p className="muted max-w-sm">Close the gaps below in order: each one is weighted by how many postings ask for it.</p>
                </div>
                <ol className="space-y-4">
                  {report.candidate_gaps.slice(0, 8).map((g) => <GapCard key={g.skill_id} gap={g} compact />)}
                </ol>
              </>
            ) : (
              <p className="lede">Add your resume to see this.</p>
            )}
          </section>
        </div>
      ))}
    </div>
  );
}
