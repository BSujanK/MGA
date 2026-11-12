"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A small localStorage-backed store shared across tabs. Everything personal
 * (resume, interview answers, calendar) stays in this browser until accounts exist.
 */
export function createLocalStore<T>(key: string, empty: T) {
  const listeners = new Set<() => void>();
  let cache: { raw: string | null; value: T } = { raw: null, value: empty };

  function read(): T {
    if (typeof window === "undefined") return empty;
    const raw = window.localStorage.getItem(key);
    if (raw === cache.raw) return cache.value;
    let value = empty;
    try {
      value = raw ? (JSON.parse(raw) as T) : empty;
    } catch {}
    cache = { raw, value };
    return value;
  }

  function write(next: T) {
    window.localStorage.setItem(key, JSON.stringify(next));
    listeners.forEach((l) => l());
  }

  function subscribe(cb: () => void) {
    listeners.add(cb);
    const onStorage = (e: StorageEvent) => e.key === key && cb();
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(cb);
      window.removeEventListener("storage", onStorage);
    };
  }

  function useStore(): [T, (update: (prev: T) => T) => void] {
    const value = useSyncExternalStore(subscribe, read, () => empty);
    const set = useCallback((update: (prev: T) => T) => write(update(read())), []);
    return [value, set];
  }

  return { read, write, useStore };
}

/** Short stable key for a pasted job description. */
export function textKey(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `text:${(h >>> 0).toString(36)}`;
}
