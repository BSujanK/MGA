"use client";

import Link from "next/link";
import { useAccount } from "@/lib/account";
import { useSyncStatus } from "@/lib/sync";

const COLS = [
  { title: "Know", links: [["/analyze", "Job fit"], ["/market", "Market"], ["/profile", "My skills"]] },
  { title: "Close", links: [["/resume", "Resume tuner"], ["/prep", "Prep kit"], ["/calendar", "Calendar"]] },
  { title: "You", links: [["/account", "Account"], ["/privacy", "Privacy"], ["/jobs", "Jobs"]] },
];

export function Footer() {
  const { user } = useAccount();
  const status = useSyncStatus();
  return (
    <footer className="no-print relative mt-auto overflow-hidden bg-stone text-whiteout">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 pb-10 pt-16 sm:px-8 md:grid-cols-12">
        <div className="space-y-3 md:col-span-5">
          <p className="text-2xl font-semibold tracking-[-0.03em]">
            The gap, measured. <span className="font-extralight text-stone-400">Then closed.</span>
          </p>
          <p className="muted max-w-sm text-stone-400">
            {user ? "Your data is saved to your account, encrypted." : "Your resume stays in this browser until you create an account."}
          </p>
          {user && status === "error" && (
            <p className="text-[0.8125rem] text-nitro" role="status">Not synced. We&apos;ll retry on your next change.</p>
          )}
        </div>
        {COLS.map((c) => (
          <nav key={c.title} className="space-y-3 md:col-span-2" aria-label={c.title}>
            <p className="eyebrow text-stone-500">{c.title}</p>
            <ul className="space-y-2 text-sm text-stone-300">
              {c.links.map(([href, label]) => (
                <li key={href}><Link href={href} className="text-fusion transition hover:text-white">{label}</Link></li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      {/* Oversized wordmark, cropped by the page edge on purpose. */}
      <p aria-hidden className="pointer-events-none -mb-[0.22em] select-none px-3 text-[clamp(7rem,28vw,24rem)] font-semibold leading-[0.8] tracking-[-0.07em] text-stone-800">
        mga<span className="text-nitro">.</span>
      </p>
    </footer>
  );
}
