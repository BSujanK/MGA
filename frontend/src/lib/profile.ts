"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { SkillOverride } from "./types";

// The candidate's resume and skill corrections live in this browser only
// until accounts exist. Nothing is sent anywhere except to the MGA API for analysis.
const KEY = "mga.profile.v1";

export interface StoredProfile {
  resumeText: string;
  fileName?: string;
  overrides: SkillOverride[];
  updatedAt?: string;
}

const EMPTY: StoredProfile = { resumeText: "", overrides: [] };
const listeners = new Set<() => void>();
let cache: { raw: string | null; value: StoredProfile } = { raw: null, value: EMPTY };

function read(): StoredProfile {
  if (typeof window === "undefined") return EMPTY;
  const raw = window.localStorage.getItem(KEY);
  if (raw === cache.raw) return cache.value;
  let value = EMPTY;
  try {
    value = raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY;
  } catch {}
  cache = { raw, value };
  return value;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => e.key === KEY && cb();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function saveProfile(next: StoredProfile) {
  window.localStorage.setItem(KEY, JSON.stringify({ ...next, updatedAt: new Date().toISOString() }));
  listeners.forEach((l) => l());
}

export function clearProfile() {
  window.localStorage.removeItem(KEY);
  listeners.forEach((l) => l());
}

export function useProfile() {
  const profile = useSyncExternalStore(subscribe, read, () => EMPTY);
  const update = useCallback((patch: Partial<StoredProfile>) => saveProfile({ ...read(), ...patch }), []);
  const hasProfile = profile.resumeText.trim().length > 0 || profile.overrides.length > 0;
  return { profile, update, hasProfile, clear: clearProfile };
}
