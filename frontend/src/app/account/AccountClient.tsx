"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { accountDeleted, useAccount } from "@/lib/account";
import { api, type SavedReportMeta } from "@/lib/api";
import { ErrorBox, Spinner } from "@/components/ui";

const KIND_LABEL: Record<SavedReportMeta["kind"], string> = {
  gap: "Job fit",
  market: "Market",
  tailored: "Tailored resume",
  prep: "Prep kit",
};

function fmtDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function AccountClient() {
  const router = useRouter();
  const { user, loading, signOut } = useAccount();
  const [reports, setReports] = useState<SavedReportMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [showDelete, setShowDelete] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!loading && !user && !leaving) router.replace("/login?next=/account");
  }, [loading, user, leaving, router]);

  useEffect(() => {
    if (!user) return;
    api.reports().then(setReports).catch((e) => setError(e.message));
  }, [user]);

  if (loading || !user) return <Spinner label="Loading your account…" />;

  async function removeReport(id: string) {
    setError(null);
    try {
      await api.deleteReport(id);
      setReports((r) => r && r.filter((x) => x.id !== id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function download() {
    setBusy("export");
    setError(null);
    try {
      const blob = await api.exportMe();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "mga-my-data.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function out(everywhere: boolean) {
    setBusy(everywhere ? "all" : "out");
    setLeaving(true);
    await signOut(everywhere);
    router.replace("/");
  }

  async function deleteAccount() {
    setBusy("delete");
    setError(null);
    try {
      await api.deleteMe();
      setLeaving(true);
      accountDeleted();
      router.replace("/");
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="card p-5" aria-labelledby="who-h">
        <h2 id="who-h" className="sr-only">Account details</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Email</dt>
            <dd className="font-medium text-slate-900" data-testid="account-email">{user.email}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Member since</dt>
            <dd className="font-medium text-slate-900">{fmtDate(user.created_at)}</dd>
          </div>
        </dl>
      </section>

      {error && <ErrorBox message={error} />}

      <section className="card p-5" aria-labelledby="reports-h">
        <h2 id="reports-h" className="mb-3 font-semibold text-slate-900">Saved reports</h2>
        {!reports ? (
          <Spinner label="Loading reports…" />
        ) : reports.length === 0 ? (
          <p className="text-sm text-slate-600">
            Nothing saved yet. Run a <Link href="/analyze" className="font-medium text-indigo-700 underline">job fit analysis</Link> and
            choose &ldquo;Save report&rdquo;.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {reports.map((r) => {
              const readiness = typeof r.summary.readiness === "number" ? Math.round(r.summary.readiness) : null;
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{r.title}</p>
                    <p className="text-xs text-slate-500">
                      {KIND_LABEL[r.kind]} · {fmtDate(r.created_at)}
                      {readiness !== null && <> · <span className="font-semibold text-slate-700">{readiness}% ready</span></>}
                    </p>
                  </div>
                  <button type="button" className="btn-ghost px-3 py-1.5" onClick={() => removeReport(r.id)} aria-label={`Delete report ${r.title}`}>
                    Delete
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card space-y-4 p-5" aria-labelledby="data-h">
        <h2 id="data-h" className="font-semibold text-slate-900">Your data</h2>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="btn-ghost" onClick={download} disabled={busy !== null}>
            {busy === "export" ? "Preparing…" : "Download my data"}
          </button>
          <button type="button" className="btn-ghost" onClick={() => out(false)} disabled={busy !== null}>Sign out</button>
          <button type="button" className="btn-ghost" onClick={() => out(true)} disabled={busy !== null}>Sign out on all devices</button>
        </div>
        <p className="text-xs text-slate-500">
          See what we store and why in the <Link href="/privacy" className="underline">privacy notice</Link>. Signing out clears your resume from this browser.
        </p>
      </section>

      <section className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50/50 p-5" aria-labelledby="danger-h">
        <h2 id="danger-h" className="font-semibold text-rose-900">Delete my account</h2>
        <p className="text-sm text-rose-900/80">
          This permanently deletes your profile, resume, interview answers, calendar and saved reports. It cannot be undone.
        </p>
        {!showDelete ? (
          <button type="button" className="btn border border-rose-300 bg-white text-rose-700 hover:bg-rose-50" onClick={() => setShowDelete(true)}>
            Delete my account…
          </button>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="confirm-delete" className="label">Type DELETE to confirm</label>
              <input id="confirm-delete" className="input w-48" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
            </div>
            <button
              type="button" className="btn bg-rose-600 text-white hover:bg-rose-700"
              disabled={confirmText !== "DELETE" || busy !== null} onClick={deleteAccount}
            >
              {busy === "delete" ? "Deleting…" : "Permanently delete"}
            </button>
            <button type="button" className="btn-ghost" onClick={() => { setShowDelete(false); setConfirmText(""); }}>Cancel</button>
          </div>
        )}
      </section>
    </div>
  );
}
