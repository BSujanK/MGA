"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useProfile } from "@/lib/profile";
import type { MarketReport } from "@/lib/types";
import { GapCard } from "@/components/GapReportView";
import { ErrorBox, ReadinessRing, Spinner, levelName } from "@/components/ui";

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
    <div className="space-y-8">
      <form className="card flex flex-wrap items-end gap-4 p-5" onSubmit={(e) => { e.preventDefault(); run(); }}>
        <div className="min-w-56 flex-1">
          <label htmlFor="role" className="label">Role</label>
          <select id="role" className="input" value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div className="min-w-44">
          <label htmlFor="city" className="label">Location</label>
          <select id="city" className="input" value={city} onChange={(e) => setCity(e.target.value)}>
            {CITIES.map((c) => <option key={c} value={c}>{c || "Anywhere in India"}</option>)}
          </select>
        </div>
        <button className="btn-primary" disabled={busy}>{busy ? "Analyzing…" : "Analyze market"}</button>
        {!hasProfile && <p className="w-full text-xs text-slate-500">Add your resume on the home page to see your personal gaps against the market.</p>}
      </form>
      {busy && <Spinner label="Reading every posting…" />}
      {error && <ErrorBox message={error} />}
      {report && !busy && (report.postings_analyzed === 0 ? (
        <p className="text-slate-600">No postings for this role and location yet. Try another city or “Anywhere”.</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-5">
          <section className="card p-5 lg:col-span-3" aria-labelledby="demand-h">
            <h2 id="demand-h" className="font-semibold text-slate-900">Skill demand</h2>
            <p className="mb-4 text-sm text-slate-500">Share of {report.postings_analyzed} postings that ask for each skill. Darker = more often a must-have.</p>
            <ul className="space-y-2.5">
              {report.skills.map((s) => (
                <li key={s.skill_id} className="grid grid-cols-[9rem_1fr_3rem] items-center gap-3 text-sm">
                  <span className="truncate text-slate-700" title={s.name}>{s.name}</span>
                  <span className="h-4 rounded bg-slate-100" title={`Typical level: ${levelName(s.avg_required_level)}; must-have in ${Math.round(s.must_rate * 100)}%`}>
                    <span
                      className="block h-4 rounded"
                      style={{ width: `${s.frequency * 100}%`, background: `rgba(79, 70, 229, ${0.35 + 0.65 * s.must_rate})` }}
                    />
                  </span>
                  <span className="text-right font-medium tabular-nums text-slate-900">{Math.round(s.frequency * 100)}%</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="space-y-4 lg:col-span-2" aria-labelledby="you-h">
            <h2 id="you-h" className="font-semibold text-slate-900">You vs. this market</h2>
            {report.market_readiness != null ? (
              <>
                <div className="card flex items-center gap-4 p-5">
                  <ReadinessRing value={report.market_readiness} label="Market readiness" size={100} />
                  <p className="text-sm text-slate-600">Close the gaps below in order: each one is weighted by how many postings ask for it.</p>
                </div>
                <ol className="space-y-3">
                  {report.candidate_gaps.slice(0, 8).map((g) => <GapCard key={g.skill_id} gap={g} />)}
                </ol>
              </>
            ) : (
              <p className="text-sm text-slate-600">Add your resume to see this.</p>
            )}
          </section>
        </div>
      ))}
    </div>
  );
}
