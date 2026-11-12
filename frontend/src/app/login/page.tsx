import { Suspense } from "react";
import { LoginClient } from "./LoginClient";
import { GapGlyph } from "@/components/ui";

export const metadata = { title: "Sign in · MGA" };

export default function LoginPage() {
  return (
    <div className="grid overflow-hidden rounded-4xl bg-white shadow-float ring-1 ring-fusion-light lg:min-h-[640px] lg:grid-cols-12">
      {/* Brand panel: the one dark block. The glyph is cropped off the edge on purpose. */}
      <aside className="relative overflow-hidden bg-stone px-7 py-12 text-whiteout sm:px-12 sm:py-14 lg:col-span-5 lg:flex lg:flex-col lg:justify-between">
        <GapGlyph className="pointer-events-none absolute top-20 -right-44 w-[34rem] max-w-none text-stone-800 sm:-right-56 lg:top-28 lg:-right-72 lg:w-[46rem]" />
        <p className="eyebrow relative flex items-center gap-2 text-stone-400">
          <span className="h-1.5 w-1.5 rounded-full bg-nitro" aria-hidden />Your account
        </p>
        <div className="relative mt-56 space-y-5 lg:mt-0">
          <p className="text-[clamp(2.5rem,4.2vw,3.5rem)] font-semibold leading-[0.98] tracking-[-0.045em]">
            Pick up where
            <span className="block font-extralight text-stone-400">you left off.</span>
          </p>
          <p className="max-w-xs text-[0.9375rem] font-light leading-relaxed text-stone-400">
            Save your resume, answers, prep progress and calendar so they follow you across devices.
            MGA still works without an account.
          </p>
        </div>
      </aside>

      <section className="flex items-center px-6 py-12 sm:px-14 sm:py-16 lg:col-span-7 lg:px-20" aria-labelledby="signin-h">
        <div className="mx-auto w-full max-w-sm space-y-8">
          <header className="space-y-2">
            <h1 id="signin-h" className="headline">Sign in</h1>
            <p className="lede">With a code sent to your email. No password.</p>
          </header>
          <Suspense>
            <LoginClient />
          </Suspense>
        </div>
      </section>
    </div>
  );
}
