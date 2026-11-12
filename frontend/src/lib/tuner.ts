"use client";

import { createLocalStore } from "./store";
import type { ChatTurn, ResumeSection } from "./types";

// Interview answers per target job, so a candidate can come back later.
type TunerState = Record<string, { turns: ChatTurn[]; updatedAt: string }>;

export const tunerStore = createLocalStore<TunerState>("mga.tuner.v1", {});

export function useTurns(jobKey: string | null) {
  const [state, set] = tunerStore.useStore();
  const turns = (jobKey && state[jobKey]?.turns) || [];
  const setTurns = (next: ChatTurn[]) => {
    if (!jobKey) return;
    set((prev) => ({ ...prev, [jobKey]: { turns: next, updatedAt: new Date().toISOString() } }));
  };
  return { turns, setTurns };
}

/** Plain-text resume, same layout as the backend's render_text. */
export function renderResumeText(header: string[], sections: ResumeSection[]): string {
  const out = [...header];
  for (const s of sections) {
    if (!s.entries.length) continue;
    out.push("", s.title.toUpperCase());
    for (const e of s.entries) {
      out.push(...e.heading.map((l) => l.text));
      out.push(...e.bullets.map((l) => `- ${l.text}`));
    }
  }
  return out.join("\n").trim() + "\n";
}
