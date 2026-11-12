"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { accountDeleted, useAccount } from "@/lib/account";
import { api, type SavedReportMeta } from "@/lib/api";
import { ErrorBox, Spinner, Stat } from "@/components/ui";

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
    <div className="space-y-16">
      {/* ---------- identity: the email is the headline ---------- */}
      <header className="no-print grid gap-10 pt-6 lg:grid-cols-12 lg:items-end">
        <div className="rise min-w-0 space-y-5 lg:col-span-8">
          <p className="eyebrow flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-nitro" aria-hidden />Your account</p>
          <h1 className="headline">
            <span className="block font-extralight text-stone-400">Signed in as</span>
            <span data-testid="account-email"
              className={`block [overflow-wrap:anywhere] ${user.email.length > 24 ? "text-title sm:text-[clamp(2rem,3.6vw,3rem)] sm:leading-[1.05]" : "text-title sm:text-headline"}`}>
              {user.email.split("@")[0]}<wbr /><span className="font-light text-stone-500">@{user.email.split("@").slice(1).join("@")}</span>
            </span>
          </h1>
          <p className="lede">Member since {fmtDate(user.created_at)}.</p>
        </div>
        <div className="lg:col-span-4 lg:justify-self-end">
          <Stat value={reports ? reports.length : "–"} label="Saved reports" size="xl" />
        </div>
      </header>

      {error && <ErrorBox message={error} />}

      <div className="grid gap-16 lg:grid-cols-12 lg:gap-12">
        {/* ---------- saved reports ---------- */}
        <section className="min-w-0 space-y-6 lg:col-span-7" aria-labelledby="reports-h">
          <div className="flex items-baseline justify-between gap-3 border-t border-fusion pt-6">
            <h2 id="reports-h" className="flex items-baseline gap-3 text-xl font-semibold tracking-[-0.02em]">
              <span className="numeral text-sm font-medium text-stone-400">01</span>Saved reports
            </h2>
          </div>
          {!reports ? (
            <Spinner label="Loading reports…" />
          ) : reports.length === 0 ? (
            <div className="panel p-6 sm:p-8">
              <p className="lede">
                Nothing saved yet. Run a <Link href="/analyze" className="font-medium text-royal underline underline-offset-2">job fit analysis</Link> and
                choose &ldquo;Save report&rdquo;.
              </p>
            </div>
          ) : (
            <ul className="card divide-y divide-fusion-light overflow-hidden">
              {reports.map((r) => {
                const readiness = typeof r.summary.readiness === "number" ? Math.round(r.summary.readiness) : null;
                return (
                  <li key={r.id} className="flex items-center gap-5 p-6 sm:gap-7 sm:p-8">
                    <div className="w-24 shrink-0 sm:w-32">
                      {readiness !== null ? (
                        <>
                          <p className="numeral text-5xl leading-none sm:text-6xl" aria-label={`${readiness}% ready`}>
                            {readiness}<span className="text-nitro">%</span>
                          </p>
                          <p className="eyebrow mt-2">Ready</p>
                        </>
                      ) : (
                        <p className="numeral text-5xl font-extralight leading-none text-fusion sm:text-6xl" aria-hidden>–</p>
                      )}
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="line-clamp-2 text-xl font-semibold tracking-[-0.02em]">{r.title}</p>
                      <p className="muted">{KIND_LABEL[r.kind]} · {fmtDate(r.created_at)}</p>
                    </div>
                    <button type="button" className="btn-quiet shrink-0" onClick={() => removeReport(r.id)} aria-label={`Delete report ${r.title}`}>
                      Delete
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ---------- data controls, offset for asymmetry ---------- */}
        <section className="min-w-0 space-y-6 lg:col-span-5 lg:mt-24" aria-labelledby="data-h">
          <div className="border-t border-fusion pt-6">
            <h2 id="data-h" className="flex items-baseline gap-3 text-xl font-semibold tracking-[-0.02em]">
              <span className="numeral text-sm font-medium text-stone-400">02</span>Your data
            </h2>
          </div>
          <div className="card space-y-6 p-6 sm:p-8">
            <div className="space-y-3">
              <p className="eyebrow">Take it with you</p>
              <button type="button" className="btn-primary w-full" onClick={download} disabled={busy !== null}>
                {busy === "export" ? "Preparing…" : "Download my data"}
              </button>
            </div>
            <div className="space-y-3 border-t border-fusion-light pt-6">
              <p className="eyebrow">Sessions</p>
              <div className="flex flex-wrap gap-3">
                <button type="button" className="btn-ghost" onClick={() => out(false)} disabled={busy !== null}>Sign out</button>
                <button type="button" className="btn-ghost" onClick={() => out(true)} disabled={busy !== null}>Sign out on all devices</button>
              </div>
            </div>
            <p className="muted border-t border-fusion-light pt-6">
              See what we store and why in the <Link href="/privacy" className="font-medium text-stone-700 underline underline-offset-2 hover:text-royal">privacy notice</Link>. Signing out clears your resume from this browser.
            </p>
          </div>
        </section>
      </div>

      {/* ---------- danger zone ---------- */}
      <section className="rounded-4xl bg-redline-soft p-7 ring-1 ring-redline/20 sm:p-12" aria-labelledby="danger-h">
        <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
          <div className="space-y-4 lg:col-span-7">
            <p className="eyebrow flex items-center gap-2 text-redline"><span className="h-1.5 w-1.5 rounded-full bg-redline" aria-hidden />Danger zone</p>
            <h2 id="danger-h" className="title">Delete my account</h2>
            <p className="max-w-lg text-[0.9375rem] leading-relaxed text-stone-700">
              This permanently deletes your profile, resume, interview answers, calendar and saved reports. It cannot be undone.
            </p>
          </div>
          <div className="lg:col-span-5">
            {!showDelete ? (
              <button type="button" className="btn bg-white text-redline ring-1 ring-redline/40 hover:ring-redline" onClick={() => setShowDelete(true)}>
                Delete my account…
              </button>
            ) : (
              <div className="space-y-4">
                <div>
                  <label htmlFor="confirm-delete" className="label">Type DELETE to confirm</label>
                  <input id="confirm-delete" className="input ring-redline/40 focus:ring-redline" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
                </div>
                <div className="flex flex-wrap gap-3">
                <button
                  type="button" className="btn-danger"
                  disabled={confirmText !== "DELETE" || busy !== null} onClick={deleteAccount}
                >
                  {busy === "delete" ? "Deleting…" : "Permanently delete"}
                </button>
                <button type="button" className="btn-ghost" onClick={() => { setShowDelete(false); setConfirmText(""); }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
