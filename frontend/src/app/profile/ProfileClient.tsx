"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useProfile } from "@/lib/profile";
import type { CandidateProfile, SkillInfo, SkillOverride } from "@/lib/types";
import { ResumeInput } from "@/components/ResumeInput";
import { ErrorBox, LEVEL_NAMES, Spinner } from "@/components/ui";

export function ProfileClient() {
  const { profile, update, clear } = useProfile();
  // Analysis result is tied to the exact resume text it came from, so a stale
  // result is never shown for a different resume.
  const [result, setResult] = useState<{ text: string; profile: CandidateProfile | null; error: string | null } | null>(null);
  const [catalog, setCatalog] = useState<SkillInfo[]>([]);
  const [adding, setAdding] = useState("");

  useEffect(() => {
    api.skills().then(setCatalog).catch(() => {});
  }, []);

  const text = profile.resumeText;
  useEffect(() => {
    if (!text.trim()) return;
    let cancelled = false;
    api.analyzeResume(text)
      .then((p) => !cancelled && setResult({ text, profile: p, error: null }))
      .catch((e) => !cancelled && setResult({ text, profile: null, error: e.message }));
    return () => { cancelled = true; };
  }, [text]);

  const current = text.trim() && result?.text === text ? result : null;
  const detected = current?.profile ?? null;
  const error = current?.error ?? null;
  const loading = !!text.trim() && !current;

  const overrides = useMemo(() => new Map(profile.overrides.map((o) => [o.skill_id, o.level])), [profile.overrides]);

  const rows = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; category: string; detected: number; evidence: string[] }>();
    for (const s of detected?.skills ?? []) {
      byId.set(s.skill_id, { id: s.skill_id, name: s.name, category: s.category, detected: s.level, evidence: s.evidence.map((e) => e.text) });
    }
    for (const o of profile.overrides) {
      if (!byId.has(o.skill_id)) {
        const info = catalog.find((c) => c.id === o.skill_id);
        byId.set(o.skill_id, { id: o.skill_id, name: info?.name ?? o.skill_id, category: info?.category ?? "", detected: 0, evidence: [] });
      }
    }
    return [...byId.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }, [detected, profile.overrides, catalog]);

  function setLevel(id: string, level: number | null) {
    const rest: SkillOverride[] = profile.overrides.filter((o) => o.skill_id !== id);
    update({ overrides: level === null ? rest : [...rest, { skill_id: id, level }] });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <section className="card space-y-3 p-5 lg:col-span-2">
        <ResumeInput compact />
        <button type="button" className="text-sm text-rose-700 underline" onClick={() => { if (confirm("Delete your resume and skill corrections from this browser?")) clear(); }}>
          Delete my data from this browser
        </button>
      </section>
      <section className="card p-5 lg:col-span-3" aria-labelledby="skills-h">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <h2 id="skills-h" className="font-semibold text-slate-900">Skills ({rows.length})</h2>
          <div className="flex gap-2">
            <select aria-label="Add a skill" className="input w-56" value={adding} onChange={(e) => setAdding(e.target.value)}>
              <option value="">Add a skill we missed…</option>
              {catalog.filter((c) => !rows.some((r) => r.id === c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button type="button" className="btn-ghost" disabled={!adding} onClick={() => { setLevel(adding, 2); setAdding(""); }}>Add</button>
          </div>
        </div>
        {loading && <Spinner label="Reading your resume…" />}
        {error && <ErrorBox message={error} />}
        {!loading && rows.length === 0 && <p className="text-sm text-slate-600">Add your resume to see your skills.</p>}
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => {
            const o = overrides.get(r.id);
            const level = o ?? r.detected;
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-40 flex-1">
                  <p className="font-medium text-slate-900">{r.name}</p>
                  <p className="text-xs text-slate-500" title={r.evidence.join("\n")}>
                    {r.category}{r.evidence[0] ? ` · “${r.evidence[0].slice(0, 70)}${r.evidence[0].length > 70 ? "…" : ""}”` : " · added by you"}
                  </p>
                </div>
                <label className="sr-only" htmlFor={`lvl-${r.id}`}>Level for {r.name}</label>
                <select id={`lvl-${r.id}`} className="input w-36" value={Math.round(level)} onChange={(e) => setLevel(r.id, Number(e.target.value))}>
                  {LEVEL_NAMES.map((n, i) => <option key={n} value={i}>{i} · {n}</option>)}
                </select>
                {o !== undefined ? (
                  <button type="button" className="text-xs text-slate-500 underline" onClick={() => setLevel(r.id, null)}>Reset</button>
                ) : (
                  <span className="w-9 text-xs text-slate-400">auto</span>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-xs text-slate-500">
          Levels: 1 aware · 2 basic (course or listed) · 3 working (used in a project or internship) · 4 strong · 5 expert.
          Soon you&apos;ll be able to prove a level with a short skill check.
        </p>
      </section>
    </div>
  );
}
