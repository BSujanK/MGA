"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { wordDiff } from "@/lib/diff";
import { renderResumeText } from "@/lib/tuner";
import type { ResumeLine, ResumeSection, TailoredResume } from "@/lib/types";
import { ErrorBox } from "./ui";

type Update = (fn: (doc: TailoredResume) => TailoredResume) => void;

function mapSections(doc: TailoredResume, fn: (s: ResumeSection, si: number) => ResumeSection): TailoredResume {
  return { ...doc, sections: doc.sections.map(fn) };
}

function editLine(doc: TailoredResume, id: string, text: string): TailoredResume {
  const fix = (l: ResumeLine) => (l.id === id ? { ...l, text, original: l.original ?? (l.source === "resume" ? l.text : l.original) } : l);
  return mapSections(doc, (s) => ({ ...s, entries: s.entries.map((e) => ({ ...e, heading: e.heading.map(fix), bullets: e.bullets.map(fix) })) }));
}

function removeLine(doc: TailoredResume, id: string): TailoredResume {
  return mapSections(doc, (s) => ({
    ...s,
    entries: s.entries
      .map((e) => ({ ...e, heading: e.heading.filter((l) => l.id !== id), bullets: e.bullets.filter((l) => l.id !== id) }))
      .filter((e) => e.heading.length || e.bullets.length),
  }));
}

/** Move a line (an interview answer) under another project or role. */
function moveLine(doc: TailoredResume, id: string, target: string): TailoredResume {
  let line: ResumeLine | undefined;
  for (const s of doc.sections) for (const e of s.entries) line ??= e.bullets.find((l) => l.id === id);
  if (!line) return doc;
  const [tsi, tei] = target.split(":").map(Number);
  // One pass: remove the line everywhere and append it to the target, then drop emptied entries.
  return mapSections(doc, (s, si) => ({
    ...s,
    entries: s.entries
      .map((e, ei) => {
        const bullets = e.bullets.filter((l) => l.id !== id);
        return { ...e, bullets: si === tsi && ei === tei ? [...bullets, line!] : bullets };
      })
      .filter((e) => e.heading.length || e.bullets.length),
  }));
}

function Diff({ before, after }: { before: string; after: string }) {
  return (
    <span>
      {wordDiff(before, after).map((p, i) =>
        p.kind === "same" ? <span key={i}>{p.text}</span>
          : p.kind === "added" ? <ins key={i} className="bg-emerald-100 text-emerald-900 no-underline">{p.text}</ins>
            : <del key={i} className="bg-rose-100 text-rose-800">{p.text}</del>,
      )}
    </span>
  );
}

function LineView({ line, bullet, showDiff, update, targets, bold }: {
  line: ResumeLine; bullet: boolean; showDiff: boolean; update: Update;
  targets: { value: string; label: string }[]; bold?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(line.text);
  const changed = !!line.original && line.original !== line.text;

  if (editing) {
    return (
      <li className={`no-print ${bullet ? "ml-5" : ""} space-y-1 py-1`}>
        <textarea aria-label="Edit line" className="input text-sm" rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} />
        <div className="flex gap-2">
          <button type="button" className="btn-primary px-3 py-1" onClick={() => { update((d) => editLine(d, line.id, draft.trim())); setEditing(false); }} disabled={!draft.trim()}>Save</button>
          <button type="button" className="btn-ghost px-3 py-1" onClick={() => { setDraft(line.text); setEditing(false); }}>Cancel</button>
        </div>
      </li>
    );
  }
  return (
    <li className={`group relative flex gap-2 py-0.5 text-sm leading-relaxed text-slate-800 ${bullet ? "ml-5 list-disc" : "list-none"}`} style={bullet ? { display: "list-item" } : undefined}>
      <span className={bold ? "font-semibold" : ""}>
        {showDiff && changed ? <Diff before={line.original!} after={line.text} /> : line.text}
      </span>
      <span className="no-print ml-1 inline-flex flex-wrap items-center gap-1 align-middle">
        {line.source === "answer" && <span className="rounded bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-800" title="Written from your interview answer. Check the wording.">from your answer</span>}
        {line.source === "added" && <span className="rounded bg-sky-100 px-1.5 text-[11px] font-semibold text-sky-800" title="Skills you've shown elsewhere that the job asks for by name">added keywords</span>}
        {changed && line.source === "resume" && <span className="rounded bg-indigo-100 px-1.5 text-[11px] font-semibold text-indigo-800" title={`Before: ${line.original}`}>reworded</span>}
        <span className="hidden gap-1 group-focus-within:inline-flex group-hover:inline-flex">
          <button type="button" className="rounded px-1.5 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900" onClick={() => setEditing(true)}>Edit</button>
          <button type="button" className="rounded px-1.5 text-[11px] font-medium text-slate-500 hover:bg-rose-50 hover:text-rose-700" onClick={() => update((d) => removeLine(d, line.id))}>Remove</button>
          {line.source === "answer" && targets.length > 0 && (
            <select aria-label="Move under" className="rounded border border-slate-200 bg-white px-1 text-[11px]" value=""
              onChange={(e) => e.target.value && update((d) => moveLine(d, line.id, e.target.value))}>
              <option value="">Move under…</option>
              {targets.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          )}
        </span>
      </span>
    </li>
  );
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TailoredResumeView({ doc, update, learnHref }: { doc: TailoredResume; update: Update; learnHref: string }) {
  const [showDiff, setShowDiff] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const reworded = doc.sections.flatMap((s) => s.entries.flatMap((e) => [...e.heading, ...e.bullets])).filter((l) => l.original && l.original !== l.text).length;

  const targets = doc.sections.flatMap((s, si) =>
    s.key === "projects" || s.key === "experience"
      ? s.entries.map((e, ei) => ({ value: `${si}:${ei}`, label: `${s.title}: ${(e.heading[0] ?? e.bullets[0])?.text.slice(0, 40) ?? ""}` }))
      : [],
  );
  const fileName = `${(doc.header[0] ?? "resume").replace(/\(.*?\)/g, "").trim()} ${doc.company ?? ""}`.trim();

  async function exportDocx() {
    setBusy(true);
    setError(null);
    try {
      download(await api.exportDocx({ header: doc.header, sections: doc.sections, filename: fileName }), `${fileName.replace(/[^A-Za-z0-9._-]+/g, "_")}.docx`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(renderResumeText(doc.header, doc.sections));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-5">
      <section className="no-print card grid gap-4 p-5 md:grid-cols-[auto_1fr]" aria-labelledby="tuned-h">
        <div className="flex items-center gap-3">
          <div className="text-center">
            <p className="text-2xl font-bold text-slate-400">{Math.round(doc.coverage_before)}%</p>
            <p className="text-xs text-slate-500">before</p>
          </div>
          <span aria-hidden className="text-slate-400">→</span>
          <div className="text-center">
            <p className="text-2xl font-bold text-emerald-600">{Math.round(doc.coverage_after)}%</p>
            <p className="text-xs text-slate-500">after</p>
          </div>
        </div>
        <div className="space-y-2">
          <h2 id="tuned-h" className="font-semibold text-slate-900">
            Keyword coverage for {doc.job_title ?? "this job"}{doc.company ? ` at ${doc.company}` : ""}
          </h2>
          <p className="text-sm text-slate-600">
            {doc.mode === "claude"
              ? `AI reworded ${reworded} line(s). Each one was checked: no new skills, tools or numbers.`
              : "Reordered by job relevance. Your wording is unchanged."}
          </p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-600">
            {doc.notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </div>
      </section>

      {doc.keywords_missing.length > 0 && (
        <section className="no-print card p-5" aria-labelledby="missing-h">
          <h2 id="missing-h" className="font-semibold text-slate-900">Not on your resume, and we won&apos;t add them</h2>
          <p className="mb-3 text-sm text-slate-600">You haven&apos;t shown these yet. Learn them, build something, then come back.</p>
          <ul className="mb-3 flex flex-wrap gap-2">
            {doc.keywords_missing.map((k) => (
              <li key={k.skill_id} className={`rounded-full px-3 py-1 text-sm ${k.importance === "must" ? "bg-rose-50 text-rose-800 ring-1 ring-rose-200" : "bg-slate-100 text-slate-700"}`}>
                {k.name}{k.importance === "must" ? " · must-have" : ""}
              </li>
            ))}
          </ul>
          <Link href={learnHref} className="btn-ghost">See the learning plan</Link>
        </section>
      )}

      {doc.guardrail.length > 0 && (
        <details className="no-print card p-5">
          <summary className="cursor-pointer font-semibold text-slate-900">AI rewrites we rejected ({doc.guardrail.length})</summary>
          <ul className="mt-3 space-y-1 text-sm text-slate-600">
            {doc.guardrail.map((g) => <li key={g.line_id + g.reason}>{g.reason}</li>)}
          </ul>
        </details>
      )}

      <div className="no-print flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary" onClick={exportDocx} disabled={busy}>{busy ? "Preparing…" : "Download DOCX"}</button>
        <button type="button" className="btn-ghost" onClick={() => window.print()}>Print / save as PDF</button>
        <button type="button" className="btn-ghost" onClick={copy}>{copied ? "Copied" : "Copy text"}</button>
        {reworded > 0 && (
          <label className="ml-auto flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={showDiff} onChange={(e) => setShowDiff(e.target.checked)} /> Show changes
          </label>
        )}
      </div>
      {error && <ErrorBox message={error} />}

      <article className="card mx-auto max-w-3xl p-8 print:border-0 print:shadow-none" aria-label="Tailored resume">
        {doc.header[0] && <h2 className="text-center text-xl font-bold text-slate-900">{doc.header[0]}</h2>}
        {doc.header.length > 1 && <p className="text-center text-sm text-slate-600">{doc.header.slice(1).join(" | ")}</p>}
        {doc.sections.filter((s) => s.entries.length).map((s) => (
          <section key={s.key + s.title} className="mt-5">
            <h3 className="mb-1 border-b border-slate-300 pb-0.5 text-sm font-bold tracking-wide text-slate-900">{s.title.toUpperCase()}</h3>
            {s.entries.map((e, ei) => (
              <ul key={ei} className="mb-1.5">
                {e.heading.map((l, hi) => (
                  <LineView key={l.id} line={l} bullet={false} bold={hi === 0 && s.key !== "skills" && s.key !== "summary"} showDiff={showDiff} update={update} targets={[]} />
                ))}
                {e.bullets.map((l) => (
                  <LineView key={l.id} line={l} bullet showDiff={showDiff} update={update} targets={targets} />
                ))}
              </ul>
            ))}
          </section>
        ))}
      </article>
    </div>
  );
}
