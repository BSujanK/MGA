"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAccount } from "@/lib/account";

const LINKS = [
  { href: "/analyze", label: "Job fit" },
  { href: "/market", label: "Market" },
  { href: "/jobs", label: "Jobs" },
  { href: "/resume", label: "Resume" },
  { href: "/prep", label: "Prep" },
  { href: "/calendar", label: "Calendar" },
  { href: "/profile", label: "My skills" },
];

/** The MGA mark: a filled block, the gap, the goal. */
export function Mark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" fill="#141413" />
      <rect x="6" y="10" width="9" height="12" rx="2.5" fill="#f7f7f4" />
      <rect x="17.5" y="10" width="3" height="12" rx="1.5" fill="#ff5b1a" />
      <rect x="22.5" y="10" width="3.5" height="12" rx="1.75" fill="#1f3fe0" />
    </svg>
  );
}

export function Nav() {
  const path = usePathname();
  const { user, loading } = useAccount();
  const [open, setOpen] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- close the menu after navigating
  useEffect(() => setOpen(false), [path]);
  return (
    <header className="no-print sticky top-0 z-30 px-3 pt-3 sm:px-6">
      <div className="mx-auto flex max-w-7xl items-center gap-4 rounded-full bg-white/75 py-2 pl-3 pr-2 ring-1 ring-fusion-light shadow-float backdrop-blur-xl backdrop-saturate-150">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 pr-2" aria-label="MGA home">
          <Mark />
          <span className="text-[0.9375rem] font-semibold tracking-[-0.03em]">MGA</span>
        </Link>
        <nav className="hidden min-w-0 flex-1 gap-0.5 overflow-x-auto text-[0.8125rem] [scrollbar-width:none] md:flex" aria-label="Main">
          {LINKS.map((l) => {
            const active = path === l.href || path.startsWith(l.href + "/");
            return (
              <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined}
                className={`shrink-0 rounded-full px-3.5 py-1.5 font-medium transition ${active ? "bg-stone text-whiteout" : "text-stone-600 hover:bg-fusion-50 hover:text-stone"}`}>
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex-1 md:hidden" />
        <button type="button" className="btn-quiet px-3 py-2 md:hidden" aria-expanded={open} aria-controls="mobile-nav"
          onClick={() => setOpen((o) => !o)}>
          <span className="sr-only">Menu</span>
          <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden><path d={open ? "M5 5l10 10M15 5L5 15" : "M3 7h14M3 13h14"} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
        <div className="shrink-0 text-[0.8125rem]">
          {loading ? <span className="block h-8 w-20" /> : user ? (
            <Link href="/account" title="Your account"
              className={`flex max-w-52 items-center gap-2 rounded-full py-1 pl-1 pr-3.5 font-medium transition ${path === "/account" ? "bg-stone text-whiteout" : "hover:bg-fusion-50"}`}>
              <span className="grid h-6 w-6 place-items-center rounded-full bg-royal text-[0.6875rem] font-semibold uppercase text-white">{user.email[0]}</span>
              <span className="hidden truncate sm:inline">{user.email}</span>
            </Link>
          ) : (
            <Link href="/login" className="btn-primary px-4 py-2 text-[0.8125rem]">Sign in</Link>
          )}
        </div>
      </div>
      {open && (
        <nav id="mobile-nav" aria-label="Main" className="rise mx-auto mt-2 max-w-7xl rounded-3xl bg-white/95 p-3 ring-1 ring-fusion-light shadow-float backdrop-blur-xl md:hidden">
          <ul className="grid grid-cols-2 gap-1">
            {LINKS.map((l) => {
              const active = path === l.href || path.startsWith(l.href + "/");
              return (
                <li key={l.href}>
                  <Link href={l.href} aria-current={active ? "page" : undefined}
                    className={`block rounded-2xl px-4 py-3 text-[0.9375rem] font-medium ${active ? "bg-stone text-whiteout" : "hover:bg-fusion-50"}`}>
                    {l.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </header>
  );
}
