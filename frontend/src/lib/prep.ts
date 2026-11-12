"use client";

import { createLocalStore } from "./store";

// Ticked-off prep items per job ("dsa:graphs", "project:url_shortener:2").
type PrepState = Record<string, { done: string[] }>;

export const prepStore = createLocalStore<PrepState>("mga.prep.v1", {});

export function usePrepProgress(jobKey: string | null) {
  const [state, set] = prepStore.useStore();
  const done = new Set((jobKey && state[jobKey]?.done) || []);
  const toggle = (id: string) => {
    if (!jobKey) return;
    set((prev) => {
      const cur = new Set(prev[jobKey]?.done ?? []);
      if (cur.has(id)) cur.delete(id);
      else cur.add(id);
      return { ...prev, [jobKey]: { done: [...cur] } };
    });
  };
  return { done, toggle };
}
