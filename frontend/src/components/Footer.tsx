"use client";

import Link from "next/link";
import { useAccount } from "@/lib/account";
import { useSyncStatus } from "@/lib/sync";

export function Footer() {
  const { user } = useAccount();
  const status = useSyncStatus();
  return (
    <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-500">
      MGA · Market Gap Analysis ·{" "}
      {user ? (
        <>Your data is saved to your account. </>
      ) : (
        <>Your resume stays in this browser until you create an account. </>
      )}
      <Link href="/privacy" className="underline hover:text-slate-700">Privacy</Link>
      {user && status === "error" && (
        <span className="ml-2 text-amber-700" role="status">Not synced. We&apos;ll retry on your next change.</span>
      )}
    </footer>
  );
}
