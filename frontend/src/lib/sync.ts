"use client";

import { useSyncExternalStore } from "react";
import { api, ApiError } from "./api";
import { calendarStore, type CalEvent } from "./calendar";
import { applyProfile, clearProfile, readProfile, subscribeProfile, type StoredProfile } from "./profile";
import { prepStore } from "./prep";
import { tunerStore } from "./tuner";

/**
 * Keeps the browser stores and the signed-in account in step.
 * Signed out: nothing here runs and localStorage works exactly as before.
 * Signed in: import once, pull (server wins), then push local edits (debounced).
 */

const DEBOUNCE_MS = 800;

// ---------- status (for a subtle "Not synced" note) ----------

export type SyncStatus = "idle" | "error";
let status: SyncStatus = "idle";
const statusListeners = new Set<() => void>();
function setStatus(s: SyncStatus) {
  if (s === status) return;
  status = s;
  statusListeners.forEach((l) => l());
}
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (cb) => {
      statusListeners.add(cb);
      return () => {
        statusListeners.delete(cb);
      };
    },
    () => status,
    () => "idle" as SyncStatus,
  );
}

// ---------- helpers ----------

type Doc = Record<string, unknown>;
const j = (v: unknown) => JSON.stringify(v);

const profileBody = (p: StoredProfile) => ({
  resume_text: p.resumeText,
  file_name: p.fileName ?? null,
  overrides: p.overrides,
});
const profileEmpty = (p: StoredProfile) => !p.resumeText.trim() && p.overrides.length === 0;

/** The API returns null for unset optional fields; the local shape uses absent keys. */
function cleanEvent(raw: Record<string, unknown>): CalEvent {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) if (v !== null && v !== undefined) out[k] = v;
  return out as unknown as CalEvent;
}

// ---------- module state ----------

let applying = false; // true while we write pulled data into local stores: never push then
let current: Runner | null = null;

/** Clear everything personal from this browser (sign out / delete account). */
export function clearLocalPersonalData() {
  current?.cancel();
  const was = applying;
  applying = true;
  try {
    clearProfile();
    tunerStore.write({});
    prepStore.write({});
    calendarStore.write([]);
  } finally {
    applying = was;
  }
}

/** Push any debounced local edits now. Used before signing out. */
export async function flushPending() {
  await current?.flush();
}

// ---------- the runner ----------

class Runner {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private ready = false;
  private flushing: Promise<void> | null = null;
  private dirty = false;
  private unsubs: Array<() => void> = [];

  // Last state known to be on the server, as JSON per item.
  private profileSnap = "";
  private tunerSnap = new Map<string, string>();
  private prepSnap = new Map<string, string>();
  private calSnap = new Map<string, string>();

  constructor(private onUnauthorized: () => void) {}

  async start() {
    try {
      await this.initial();
    } catch (e) {
      this.fail(e);
      return;
    }
    if (this.stopped) return;
    this.ready = true;
    this.unsubs = [
      subscribeProfile(() => this.touch()),
      tunerStore.subscribe(() => this.touch()),
      prepStore.subscribe(() => this.touch()),
      calendarStore.subscribe(() => this.touch()),
    ];
    // Anything that changed while we were pulling.
    this.touch();
  }

  stop() {
    this.stopped = true;
    this.cancel();
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
  }

  cancel() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.dirty = false;
  }

  private fail(e: unknown) {
    if (e instanceof ApiError && e.status === 401) this.onUnauthorized();
    else setStatus("error");
  }

  private async initial() {
    // 1. Merge what this browser had before sign-in into the account (account data wins).
    const local = readProfile();
    await api.importLocal({
      profile: profileEmpty(local) ? undefined : profileBody(local),
      tuner: tunerStore.read(),
      prep: prepStore.read(),
      calendar: calendarStore.read(),
    });
    // 2. Pull. From here the server is the source of truth.
    const [profile, tuner, prep, calendar] = await Promise.all([
      api.getProfile(), api.getDocs("tuner"), api.getDocs("prep"), api.getCalendar(),
    ]);
    if (this.stopped) return;
    const toMap = (docs: Record<string, { data: unknown }>) =>
      Object.fromEntries(Object.entries(docs).map(([k, v]) => [k, v.data])) as Record<string, Doc>;
    const tunerMap = toMap(tuner);
    const prepMap = toMap(prep);
    const events = calendar.map((e) => cleanEvent(e as unknown as Record<string, unknown>));

    applying = true;
    try {
      const serverProfile: StoredProfile = {
        resumeText: profile.resume_text,
        fileName: profile.file_name ?? undefined,
        overrides: profile.overrides,
        updatedAt: profile.updated_at ?? undefined,
      };
      if (profileEmpty(serverProfile) && !profileEmpty(local)) {
        // Nothing saved server-side (e.g. skill corrections only): keep local, it gets pushed below.
        this.profileSnap = j(profileBody({ resumeText: "", overrides: [] }));
      } else {
        applyProfile(serverProfile);
        this.profileSnap = j(profileBody(serverProfile));
      }
      tunerStore.write(tunerMap as unknown as ReturnType<typeof tunerStore.read>);
      prepStore.write(prepMap as unknown as ReturnType<typeof prepStore.read>);
      calendarStore.write(events);
    } finally {
      applying = false;
    }
    this.tunerSnap = new Map(Object.entries(tunerMap).map(([k, v]) => [k, j(v)]));
    this.prepSnap = new Map(Object.entries(prepMap).map(([k, v]) => [k, j(v)]));
    this.calSnap = new Map(events.map((e) => [e.id, j(e)]));
    setStatus("idle");
  }

  private touch() {
    if (applying || this.stopped || !this.ready) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), DEBOUNCE_MS);
  }

  /** Push whatever differs from the last synced snapshot. Serialized; reruns if edited meanwhile. */
  flush(): Promise<void> {
    if (!this.ready || this.stopped) return Promise.resolve();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.flushing) {
      this.dirty = true;
      return this.flushing;
    }
    this.flushing = (async () => {
      try {
        do {
          this.dirty = false;
          await this.pushDiff();
        } while (this.dirty && !this.stopped);
        setStatus("idle");
      } catch (e) {
        this.fail(e);
      } finally {
        this.flushing = null;
      }
    })();
    return this.flushing;
  }

  private async pushDiff() {
    const prof = readProfile();
    const pj = j(profileBody(prof));
    if (pj !== this.profileSnap) {
      await api.putProfile(profileBody(prof));
      this.profileSnap = pj;
    }
    await this.pushDocs("tuner", tunerStore.read(), this.tunerSnap);
    await this.pushDocs("prep", prepStore.read(), this.prepSnap);

    const events = new Map(calendarStore.read().map((e) => [e.id, e]));
    for (const [id, ev] of events) {
      const s = j(ev);
      if (this.calSnap.get(id) !== s) {
        await api.putEvent(ev);
        this.calSnap.set(id, s);
      }
    }
    for (const id of [...this.calSnap.keys()]) {
      if (!events.has(id)) {
        await api.deleteEvent(id);
        this.calSnap.delete(id);
      }
    }
  }

  private async pushDocs(kind: "tuner" | "prep", docs: Record<string, unknown>, snap: Map<string, string>) {
    for (const [key, data] of Object.entries(docs)) {
      const s = j(data);
      if (snap.get(key) !== s) {
        await api.putDoc(kind, key, data);
        snap.set(key, s);
      }
    }
    for (const key of [...snap.keys()]) {
      if (!(key in docs)) {
        await api.deleteDoc(kind, key);
        snap.delete(key);
      }
    }
  }
}

/** Start syncing for the signed-in user. Returns a stop function. */
export function startSync(onUnauthorized: () => void): () => void {
  const runner = new Runner(onUnauthorized);
  current = runner;
  void runner.start();
  return () => {
    runner.stop();
    if (current === runner) current = null;
  };
}
