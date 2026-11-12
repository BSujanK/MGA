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
          : p.kind === "added" ? <ins key={i} className="rounded-sm bg-royal-soft text-royal no-underline">{p.text}</ins>
            : <del key={i} className="rounded-sm bg-redline-soft text-redline line-through">{p.text}</del>,
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
    <li className={`group relative flex gap-2 py-0.5 text-[0.8125rem] leading-relaxed text-stone-700 ${bullet ? "ml-5 list-disc" : "list-none"}`} style={bullet ? { display: "list-item" } : undefined}>
      <span className={bold ? "font-semibold" : ""}>
        {showDiff && changed ? <Diff before={line.original!} after={line.text} /> : line.text}
      </span>
      <span className="no-print ml-1 inline-flex flex-wrap items-center gap-1 align-middle">
        {line.source === "answer" && <span className="rounded-full bg-nitro-soft px-2 text-[0.6875rem] font-semibold text-[#c2410c]" title="Written from your interview answer. Check the wording.">from your answer</span>}
        {line.source === "added" && <span className="rounded-full bg-royal-soft px-2 text-[0.6875rem] font-semibold text-royal" title="Skills you've shown elsewhere that the job asks for by name">added keywords</span>}
        {changed && line.source === "resume" && <span className="rounded-full bg-fusion-light px-2 text-[0.6875rem] font-semibold text-stone-700" title={`Before: ${line.original}`}>reworded</span>}
        <span className="hidden gap-1 group-focus-within:inline-flex group-hover:inline-flex">
          <button type="button" className="rounded-full px-2 text-[0.6875rem] font-medium text-stone-500 hover:bg-fusion-light hover:text-stone" onClick={() => setEditing(true)}>Edit</button>
          <button type="button" className="rounded-full px-2 text-[0.6875rem] font-medium text-stone-500 hover:bg-redline-soft hover:text-redline" onClick={() => update((d) => removeLine(d, line.id))}>Remove</button>
          {line.source === "answer" && targets.length > 0 && (
            <select aria-label="Move under" className="rounded-full bg-white px-1.5 text-[0.6875rem] text-stone-600 ring-1 ring-fusion" value=""
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
    <div className="space-y-16 print:space-y-0">
      {/* ---------- before -> after: the one dark block, oversized numerals ---------- */}
      <section className="no-print surface-dark relative overflow-hidden px-7 py-12 sm:px-14 sm:py-16" aria-labelledby="tuned-h">
        <div className="relative grid gap-12 lg:grid-cols-12">
          <div className="flex min-w-0 flex-col justify-between gap-10 lg:col-span-7">
            <h2 id="tuned-h" className="eyebrow text-stone-400">
              Keyword coverage for {doc.job_title ?? "this job"}{doc.company ? ` at ${doc.company}` : ""}
            </h2>
            <div className="flex items-end gap-3 sm:gap-8">
              <div className="space-y-2">
                <p className="numeral text-5xl leading-none text-stone-500 sm:text-8xl">{Math.round(doc.coverage_before)}<span className="text-2xl sm:text-5xl">%</span></p>
                <p className="eyebrow text-stone-400">before</p>
              </div>
              <span aria-hidden className="mb-6 text-2xl font-extralight text-stone-500 sm:mb-12 sm:text-5xl">→</span>
              <div className="space-y-2">
                <p className="numeral -mr-2 text-[5.25rem] leading-[0.8] text-whiteout sm:text-[10rem]">{Math.round(doc.coverage_after)}<span className="text-nitro">%</span></p>
                <p className="eyebrow text-stone-400">after</p>
              </div>
            </div>
          </div>
          <div className="min-w-0 space-y-5 lg:col-span-5">
            <p className="text-xl font-semibold leading-snug tracking-[-0.02em]">
              We never add a skill, tool or number you didn&apos;t give us.
            </p>
            <p className="text-[0.9375rem] font-light leading-relaxed text-stone-400">
              {doc.mode === "claude"
                ? `AI reworded ${reworded} line(s). Each one was checked: no new skills, tools or numbers.`
                : "Reordered by job relevance. Your wording is unchanged."}
            </p>
            {doc.notes.length > 0 && (
              <ul className="space-y-1.5 border-t border-white/10 pt-5 text-[0.8125rem] font-light leading-relaxed text-stone-400">
                {doc.notes.map((n) => (
                  <li key={n} className="flex gap-2.5"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-nitro" aria-hidden />{n}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <div className="grid gap-12 lg:grid-cols-12 lg:gap-14 print:block">
        {/* ---------- findings and actions: a tidy side column ---------- */}
        <div className="no-print space-y-10 lg:col-span-4 lg:sticky lg:top-24 lg:self-start">
          <div className="space-y-3">
            <p className="eyebrow">Take it with you</p>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn-primary" onClick={exportDocx} disabled={busy}>{busy ? "Preparing…" : "Download DOCX"}</button>
              <button type="button" className="btn-ghost" onClick={() => window.print()}>Print / save as PDF</button>
              <button type="button" className="btn-ghost" onClick={copy}>{copied ? "Copied" : "Copy text"}</button>
            </div>
            {reworded > 0 && (
              <label className="flex items-center gap-2.5 pt-1 text-[0.8125rem] text-stone-600">
                <input type="checkbox" className="h-4 w-4 accent-royal" checked={showDiff} onChange={(e) => setShowDiff(e.target.checked)} /> Show changes
              </label>
            )}
            {error && <ErrorBox message={error} />}
          </div>

          {doc.keywords_missing.length > 0 && (
            <section className="panel space-y-4 p-6" aria-labelledby="missing-h">
              <div className="space-y-2">
                <h2 id="missing-h" className="text-xl font-semibold tracking-[-0.02em]">Not on your resume, <span className="font-extralight text-stone-400">and we won&apos;t add them</span></h2>
                <p className="muted font-light">You haven&apos;t shown these yet. Learn them, build something, then come back.</p>
              </div>
              <ul className="flex flex-wrap gap-2">
                {doc.keywords_missing.map((k) => (
                  <li key={k.skill_id} className={`chip px-3 py-1.5 text-[0.8125rem] ${k.importance === "must" ? "bg-redline-soft text-redline" : "bg-white text-stone-600 ring-1 ring-fusion"}`}>
                    {k.name}{k.importance === "must" ? " · must-have" : ""}
                  </li>
                ))}
              </ul>
              <Link href={learnHref} className="btn-ghost">See the learning plan</Link>
            </section>
          )}

          {doc.guardrail.length > 0 && (
            <details className="group rounded-3xl bg-white p-6 ring-1 ring-fusion-light">
              <summary className="cursor-pointer text-[0.9375rem] font-semibold">AI rewrites we rejected ({doc.guardrail.length})</summary>
              <ul className="mt-3 space-y-1.5 text-[0.8125rem] leading-relaxed text-stone-500">
                {doc.guardrail.map((g) => <li key={g.line_id + g.reason}>{g.reason}</li>)}
              </ul>
            </details>
          )}
        </div>

        {/* ---------- the document on a desk ---------- */}
        <div className="rounded-4xl bg-fusion-light/70 px-3 py-8 ring-1 ring-fusion-light sm:px-8 sm:py-12 lg:col-span-8 print:rounded-none print:bg-transparent print:p-0 print:ring-0">
          <article
            className="mx-auto max-w-3xl rounded-md bg-white px-6 py-10 shadow-[0_1px_1px_rgb(20_20_19/0.06),0_2px_4px_rgb(20_20_19/0.04),0_24px_48px_-16px_rgb(20_20_19/0.28)] ring-1 ring-stone/5 sm:px-12 sm:py-14 print:max-w-none print:rounded-none print:p-0 print:shadow-none print:ring-0"
            aria-label="Tailored resume"
          >
            {doc.header[0] && <h2 className="text-center text-3xl font-semibold tracking-[-0.03em] text-stone">{doc.header[0]}</h2>}
            {doc.header.length > 1 && <p className="mt-1.5 text-center text-[0.8125rem] font-light text-stone-600">{doc.header.slice(1).join(" | ")}</p>}
            {doc.sections.filter((s) => s.entries.length).map((s) => (
              <section key={s.key + s.title} className="mt-7">
                <h3 className="mb-2 border-b border-stone pb-1 text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-stone">{s.title}</h3>
                {s.entries.map((e, ei) => (
                  <ul key={ei} className="mb-2.5">
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
      </div>
    </div>
  );
}

