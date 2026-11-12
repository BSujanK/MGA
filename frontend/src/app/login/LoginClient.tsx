"use client";

import Link from "next/link";
import Script from "next/script";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { setSignedIn, useAccount } from "@/lib/account";
import { api, ApiError } from "@/lib/api";
import { ErrorBox } from "@/components/ui";

const CONSENT_NEEDED = "new_account_requires_consent";

interface GoogleId {
  accounts: {
    id: {
      initialize: (cfg: { client_id: string; callback: (r: { credential: string }) => void }) => void;
      renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
    };
  };
}

/** Only same-site paths: never bounce someone to another origin. */
function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\") ? raw : "/";
}

export function LoginClient() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const { user, loading } = useAccount();

  const [googleId, setGoogleId] = useState<string | null>(null);
  const [gsiLoaded, setGsiLoaded] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [needConsent, setNeedConsent] = useState(false);
  const [agree, setAgree] = useState(false);
  const [pendingGoogle, setPendingGoogle] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const googleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.authConfig().then((c) => setGoogleId(c.google_client_id)).catch(() => {});
  }, []);

  // Already signed in: go where they were headed.
  useEffect(() => {
    if (!loading && user) router.replace(next);
  }, [loading, user, next, router]);

  const finish = useCallback(
    (u: Parameters<typeof setSignedIn>[0]) => {
      setSignedIn(u);
      router.replace(next);
    },
    [router, next],
  );

  const googleSubmit = useCallback(
    async (credential: string, accept: boolean) => {
      setBusy(true);
      setError(null);
      try {
        finish(await api.googleSignIn(credential, accept));
      } catch (e) {
        if (e instanceof ApiError && e.message === CONSENT_NEEDED) {
          setPendingGoogle(credential);
          setNeedConsent(true);
        } else {
          setError((e as Error).message);
        }
      } finally {
        setBusy(false);
      }
    },
    [finish],
  );

  useEffect(() => {
    const gid = (window as unknown as { google?: GoogleId }).google;
    if (!googleId || !gsiLoaded || !gid || !googleRef.current) return;
    gid.accounts.id.initialize({
      client_id: googleId,
      callback: (r) => void googleSubmit(r.credential, false),
    });
    gid.accounts.id.renderButton(googleRef.current, { theme: "outline", size: "large", text: "continue_with", width: 320 });
  }, [googleId, gsiLoaded, googleSubmit]);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.sendCode(email.trim());
      setSent(true);
      setDevCode(res.dev_code ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (pendingGoogle) {
      await googleSubmit(pendingGoogle, agree);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      finish(await api.verifyCode(email.trim(), code.trim(), agree));
    } catch (err) {
      if (err instanceof ApiError && err.message === CONSENT_NEEDED) setNeedConsent(true);
      else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const consent = (
    <div className="space-y-3 rounded-2xl bg-fusion-50 p-4 ring-1 ring-fusion-light">
      <p className="text-[0.9375rem] font-semibold tracking-[-0.01em]">Welcome. One last step to create your account.</p>
      <label className="flex items-start gap-3 text-[0.8125rem] leading-relaxed text-stone-600">
        <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[#1f3fe0]" checked={agree} onChange={(e) => setAgree(e.target.checked)} required />
        <span>
          I agree to the Terms and the <Link href="/privacy" target="_blank" className="font-medium text-royal underline underline-offset-2">Privacy notice</Link>,
          and to MGA storing my resume (encrypted) to analyse it.
        </span>
      </label>
    </div>
  );

  return (
    <div className="space-y-6">
      {pendingGoogle ? (
        <form onSubmit={verify} className="space-y-5">
          {consent}
          <button type="submit" className="btn-primary w-full py-3.5 text-[0.9375rem]" disabled={!agree || busy}>
            {busy ? "Creating account…" : "Create account"}
          </button>
        </form>
      ) : !sent ? (
        <form onSubmit={sendCode} className="space-y-5">
          <div>
            <label htmlFor="email" className="label">Email</label>
            <input
              id="email" type="email" required autoComplete="email" className="input py-3.5" placeholder="you@example.com"
              value={email} onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <button type="submit" className="btn-primary w-full py-3.5 text-[0.9375rem]" disabled={busy || !email.trim()}>
            {busy ? "Sending…" : "Send code"}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-5">
          <p className="muted">
            We sent a 6-digit code to <strong className="font-semibold text-stone">{email}</strong>. It expires in 10 minutes.
          </p>
          {devCode && (
            <p className="rounded-2xl bg-nitro-soft px-4 py-3 text-[0.8125rem] leading-relaxed text-[#c2410c]" data-testid="dev-code">
              Dev only (no email provider configured): your code is <strong className="font-semibold tabular-nums tracking-[0.12em]">{devCode}</strong>
            </p>
          )}
          <div>
            <label htmlFor="code" className="label">6-digit code</label>
            <input
              id="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required
              className="input py-4 text-center text-[2.25rem] font-semibold leading-none tabular-nums tracking-[0.4em] indent-[0.4em] placeholder:font-extralight placeholder:text-fusion"
              placeholder="000000"
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          {needConsent && consent}
          <button type="submit" className="btn-primary w-full py-3.5 text-[0.9375rem]" disabled={busy || code.length !== 6 || (needConsent && !agree)}>
            {busy ? "Checking…" : needConsent ? "Create account" : "Verify and sign in"}
          </button>
          <button
            type="button" className="btn-quiet w-full"
            onClick={() => { setSent(false); setCode(""); setNeedConsent(false); setAgree(false); setError(null); setDevCode(null); }}
          >
            Use a different email
          </button>
        </form>
      )}
      {error && <ErrorBox message={error} />}
      {googleId && !pendingGoogle && (
        <>
          <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={() => setGsiLoaded(true)} onReady={() => setGsiLoaded(true)} />
          <div className="flex items-center gap-3 text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-stone-500">
            <span className="h-px flex-1 bg-fusion" /> or <span className="h-px flex-1 bg-fusion" />
          </div>
          <div ref={googleRef} className="flex justify-center" />
        </>
      )}
      <p className="muted border-t border-fusion-light pt-5">
        By signing in you accept the <Link href="/privacy" className="font-medium text-stone-700 underline underline-offset-2 hover:text-royal">Privacy notice</Link>. Nothing is shared with employers.
      </p>
    </div>
  );
}
