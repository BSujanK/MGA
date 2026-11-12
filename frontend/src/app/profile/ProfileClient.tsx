"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useProfile } from "@/lib/profile";
import type { CandidateProfile, SkillInfo, SkillOverride } from "@/lib/types";
import { ResumeInput } from "@/components/ResumeInput";
import { ErrorBox, LEVEL_NAMES, Spinner } from "@/components/ui";

const CATEGORY_LABELS: Record<string, string> = { cs_fundamentals: "CS fundamentals", devops: "DevOps", ml: "Machine learning", data: "Data", rest: "APIs" };
function categoryLabel(c: string) {
  if (CATEGORY_LABELS[c]) return CATEGORY_LABELS[c];
  const t = c.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

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

  // Group by category for a readable inventory.
  const groups = useMemo(() => {
    const m = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = r.category || "Added by you";
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()];
  }, [rows]);
  const corrected = profile.overrides.length;

  return (
    <div className="grid gap-12 lg:grid-cols-12 lg:gap-10">
      <section className="space-y-8 order-2 lg:col-span-7" aria-labelledby="skills-h">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="space-y-2">
            <h2 id="skills-h" className="eyebrow">Skills</h2>
            <p className="numeral text-8xl leading-none sm:text-9xl">{rows.length}</p>
            <p className="muted">{corrected > 0 ? `${corrected} corrected by you` : "all read from your resume"}</p>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <select aria-label="Add a skill" className="input w-full sm:w-56" value={adding} onChange={(e) => setAdding(e.target.value)}>
              <option value="">Add a skill we missed…</option>
              {catalog.filter((c) => !rows.some((r) => r.id === c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button type="button" className="btn-primary" disabled={!adding} onClick={() => { setLevel(adding, 2); setAdding(""); }}>Add</button>
          </div>
        </div>
        {loading && <Spinner label="Reading your resume…" />}
        {error && <ErrorBox message={error} />}
        {!loading && rows.length === 0 && <p className="text-[0.9375rem] text-stone-600">Add your resume to see your skills.</p>}
        <div className="space-y-12">
          {groups.map(([category, list]) => (
            <div key={category} className="space-y-1">
              <div className="flex items-baseline justify-between border-t border-stone pt-3">
                <h3 className="text-xl font-semibold tracking-[-0.02em]">{categoryLabel(category)}</h3>
                <span className="numeral text-sm text-stone-400">{list.length}</span>
              </div>
              <ul className="divide-y divide-fusion-light">
                {list.map((r) => {
                  const o = overrides.get(r.id);
                  const level = o ?? r.detected;
                  const lv = Math.round(level);
                  return (
                    <li key={r.id} className="grid items-center gap-x-5 gap-y-3 py-4 sm:grid-cols-12">
                      <div className="sm:col-span-5">
                        <p className="text-[0.9375rem] font-semibold">{r.name}</p>
                        <p className="muted line-clamp-1" title={r.evidence.join("\n")}>
                          {r.evidence[0] ? `“${r.evidence[0].slice(0, 70)}${r.evidence[0].length > 70 ? "…" : ""}”` : "Added by you"}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 sm:col-span-3" aria-hidden>
                        <div className="flex flex-1 gap-1">
                          {[1, 2, 3, 4, 5].map((n) => (
                            <span key={n} className={`h-2 flex-1 rounded-full ${n <= lv ? (o !== undefined ? "bg-nitro" : "bg-stone") : "bg-fusion-light"}`} />
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 sm:col-span-4 sm:justify-end">
                        <label className="sr-only" htmlFor={`lvl-${r.id}`}>Level for {r.name}</label>
                        <select id={`lvl-${r.id}`} className="input w-36 py-2" value={lv} onChange={(e) => setLevel(r.id, Number(e.target.value))}>
                          {LEVEL_NAMES.map((n, i) => <option key={n} value={i}>{i} · {n}</option>)}
                        </select>
                        {o !== undefined ? (
                          <button type="button" className="btn-quiet px-2 py-1 text-xs" onClick={() => setLevel(r.id, null)}>Reset</button>
                        ) : (
                          <span className="eyebrow w-10 text-stone-400">Auto</span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
        <p className="muted max-w-xl">
          Levels: 1 aware · 2 basic (course or listed) · 3 working (used in a project or internship) · 4 strong · 5 expert.
          Soon you&apos;ll be able to prove a level with a short skill check.
        </p>
      </section>
      <section className="card order-1 h-fit space-y-4 p-6 sm:p-8 lg:sticky lg:top-24 lg:col-span-5 lg:mt-24">
        <ResumeInput compact />
        <button type="button" className="btn-quiet -ml-3 text-redline hover:text-redline" onClick={() => { if (confirm("Delete your resume and skill corrections from this browser?")) clear(); }}>
          Delete my data from this browser
        </button>
      </section>
    </div>
  );
}
