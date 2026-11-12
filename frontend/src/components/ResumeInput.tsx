"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { useProfile } from "@/lib/profile";
import { ErrorBox, Spinner } from "./ui";

/** Paste or upload a resume. Saved to this browser so every page can use it. */
export function ResumeInput({ compact = false, onSaved }: { compact?: boolean; onSaved?: () => void }) {
  const { profile, update } = useProfile();
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const text = draft ?? profile.resumeText;
  const dirty = draft !== null && draft !== profile.resumeText;

  async function onFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const res = await api.parseResume(file);
      setDraft(null);
      update({ resumeText: res.text, fileName: res.filename });
      onSaved?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function save() {
    update({ resumeText: text, fileName: undefined });
    setDraft(null);
    onSaved?.();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label htmlFor="resume" className="eyebrow">
          Your resume {profile.fileName && !dirty ? <span className="font-normal text-stone-500">· from {profile.fileName}</span> : null}
        </label>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md" className="hidden" id="resume-file"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
          <button type="button" className="btn-ghost px-4 py-2" onClick={() => fileRef.current?.click()} disabled={busy}>
            Upload PDF / DOCX
          </button>
          <button type="button" className="btn-quiet" onClick={() => loadSample(setDraft)} disabled={busy}>
            Use sample
          </button>
        </div>
      </div>
      <textarea
        id="resume" className={`input resize-y rounded-3xl bg-whiteout px-5 py-4 text-[0.9375rem] font-light leading-relaxed tracking-[-0.005em] ring-0 focus:bg-white focus:ring-2 ${compact ? "h-52" : "h-80"}`}
        placeholder="Paste your resume text here, or upload a file. Include skills, projects, internships and certifications."
        value={text} onChange={(e) => setDraft(e.target.value)}
      />
      {busy && <Spinner label="Reading your file…" />}
      {error && <ErrorBox message={error} />}
      {dirty && (
        <div className="flex gap-2">
          <button type="button" className="btn-primary" onClick={save} disabled={!text.trim()}>Save resume</button>
          <button type="button" className="btn-ghost" onClick={() => setDraft(null)}>Discard changes</button>
        </div>
      )}
    </div>
  );
}

const SAMPLE = `Aarav Sharma (sample candidate)
B.Tech Computer Science, 2026 | Bengaluru

Technical Skills
Languages: Java, Python, JavaScript, C
Web: HTML, CSS, React
Databases: MySQL
Tools: Git, VS Code, Postman

Projects
- Campus Canteen App: built a food-ordering web app with React and a Node.js + Express backend, MySQL database; 300 students use it
- Expense Tracker: developed a REST API in Java with Spring Boot and MySQL, wrote JUnit tests
- Solved 400+ problems on LeetCode (data structures and algorithms), contest rating 1650

Internship
Web Development Intern, Small Studio (May-Jul 2025)
- Implemented responsive pages in React and CSS for 3 client websites
- Integrated REST APIs and fixed bugs reported by QA

Certifications
- AWS Cloud Practitioner (in progress)
- NPTEL: Database Management Systems`;

function loadSample(set: (v: string) => void) {
  set(SAMPLE);
}
