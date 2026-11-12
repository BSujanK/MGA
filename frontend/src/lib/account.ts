"use client";

import { useSyncExternalStore } from "react";
import { api, ApiError, type AccountUser } from "./api";
import { clearLocalPersonalData, flushPending } from "./sync";

interface AccountState {
  user: AccountUser | null;
  loading: boolean;
}

const listeners = new Set<() => void>();
let state: AccountState = { user: null, loading: true };
let started = false;

function set(next: AccountState) {
  state = next;
  listeners.forEach((l) => l());
}

/** Ask the API who we are. A 401 simply means signed out. */
export async function refreshAccount(): Promise<AccountUser | null> {
  try {
    const me = await api.me();
    set({ user: me.user, loading: false });
    return me.user;
  } catch (e) {
    // 401 = signed out. Any other failure (API down): treat as signed out so the app stays usable.
    if (!(e instanceof ApiError) || e.status !== 401) console.warn("Could not load account", e);
    set({ user: null, loading: false });
    return null;
  }
}

/** Called after a successful sign-in with the user the API returned. */
export function setSignedIn(user: AccountUser) {
  set({ user, loading: false });
}

export async function signOut(everywhere = false) {
  await flushPending().catch(() => {});
  try {
    await (everywhere ? api.logoutAll() : api.logout());
  } catch {}
  set({ user: null, loading: false });
  clearLocalPersonalData();
}

/** After DELETE /me succeeded. */
export function accountDeleted() {
  set({ user: null, loading: false });
  clearLocalPersonalData();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!started) {
    started = true;
    void refreshAccount();
  }
  return () => {
    listeners.delete(cb);
  };
}

const SERVER: AccountState = { user: null, loading: true };

export function useAccount() {
  const s = useSyncExternalStore(subscribe, () => state, () => SERVER);
  return { user: s.user, loading: s.loading, refresh: refreshAccount, signOut };
}
