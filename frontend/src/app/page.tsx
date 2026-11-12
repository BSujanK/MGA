import Link from "next/link";
import { HomeResume } from "./HomeResume";
import { GapGlyph, LevelBar, StatusChip } from "@/components/ui";

const FEATURES = [
  { n: "02", title: "Job fit", line: "Every skill a posting asks for, marked Strong, Partial, Transferable or Missing. With the evidence and the hours to close it.", href: "/analyze" },
  { n: "03", title: "The market", line: "What SDE-1 roles in Bengaluru actually ask for, and which of your gaps unlock the most jobs.", href: "/market" },
  { n: "04", title: "Resume tuner", line: "A short interview finds what your resume leaves out. Then it's reordered for one job. Nothing invented.", href: "/resume" },
  { n: "05", title: "Prep kit", line: "A week-by-week plan: DSA, core subjects, the online assessment, interview questions and a project.", href: "/prep" },
  { n: "06", title: "Calendar", line: "Applications, assessments and interviews in one place, with reminders.", href: "/calendar" },
];

/** A close-up of a real report, cropped by its frame: the product as the image. */
function ReportCloseUp() {
  const rows = [
    { name: "Operating Systems", status: "missing" as const, have: 0, need: 3.5, h: "39 h" },
    { name: "DBMS Concepts", status: "partial" as const, have: 2, need: 3.5, h: "14 h" },
    { name: "Object-Oriented Programming", status: "transferable" as const, have: 1.8, need: 3.5, h: "11 h" },
    { name: "Java", status: "strong" as const, have: 3.5, need: 3, h: "Ready" },
  ];
  return (
    <div className="relative lg:-mr-24 xl:-mr-40">
      <div className="card relative overflow-hidden p-7 sm:p-9 lg:rotate-[-1.5deg]">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="eyebrow">Software Development Engineer I · Kestrel Pay</p>
            <p className="mt-2 max-w-xs text-sm text-stone-500">Focus first on Operating Systems and DBMS. About 6 weeks at 10 h a week.</p>
          </div>
          <span className="chip bg-stone text-whiteout">Sample</span>
        </div>
        {/* Oversized numeral, cut off by the card edge on purpose. */}
        <p aria-hidden className="numeral -mb-6 -ml-2 mt-2 text-[9.5rem] leading-none text-stone sm:text-[12rem]">
          69<span className="text-nitro">%</span>
        </p>
        <ul className="relative space-y-5 rounded-3xl bg-whiteout/90 p-5 ring-1 ring-fusion-light backdrop-blur">
          {rows.map((r) => (
            <li key={r.name} className="space-y-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">{r.name}</span>
                <span className="flex items-center gap-3"><span className="muted">{r.h}</span><StatusChip status={r.status} /></span>
              </div>
              <LevelBar have={r.have} need={r.need} status={r.status} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <div className="space-y-32">
      {/* ---------- hero: asymmetric, oversized ---------- */}
      <section className="grid items-center gap-14 pt-6 lg:grid-cols-12 lg:gap-8">
        <div className="rise space-y-8 lg:col-span-6">
          <p className="eyebrow flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-nitro" aria-hidden />For students and freshers in tech, India</p>
          <h1 className="display">
            Know the gap.
            <span className="block font-extralight text-stone-400">Then close it.</span>
          </h1>
          <p className="lede max-w-md">
            MGA compares your skills with the job you want and the whole market, one skill at a time:
            what&apos;s missing, how long it takes, where to learn it.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/analyze" className="btn-primary px-6 py-3.5 text-[0.9375rem]">Check my fit for a job</Link>
            <Link href="/market" className="btn-ghost px-6 py-3.5 text-[0.9375rem]">See the market →</Link>
          </div>
        </div>
        <div className="lg:col-span-6">
          <ReportCloseUp />
        </div>
      </section>

      {/* ---------- the rule, as a graphic ---------- */}
      <section className="surface-dark relative overflow-hidden px-7 py-16 sm:px-14 sm:py-20">
        <GapGlyph className="pointer-events-none absolute -right-28 -top-24 w-[34rem] text-stone-800 opacity-80 sm:-right-16" />
        <div className="relative grid gap-12 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-7">
            <p className="eyebrow text-stone-400">The one rule</p>
            <p className="text-headline font-semibold">
              <span className="relative inline-block text-stone-500">
                Not eligible.
                <span aria-hidden className="absolute left-[-4%] top-1/2 h-[0.09em] w-[108%] -rotate-3 rounded-full bg-redline" />
              </span>
              <span className="block">Just the gap, measured.</span>
            </p>
            <p className="max-w-lg text-[0.9375rem] font-light leading-relaxed text-stone-400">
              MGA never gives a verdict. Every line shows the sentence in the posting, the line in your resume,
              and the hours it takes to close.
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-10 self-end lg:col-span-5">
            {[
              ["86", "skills mapped"],
              ["4", "statuses, no verdicts"],
              ["0", "invented links"],
              ["24", "gap-closing projects"],
            ].map(([v, l]) => (
              <div key={l} className="border-t border-stone-700 pt-4">
                <dt className="sr-only">{l}</dt>
                <dd className="numeral text-6xl leading-none">{v}</dd>
                <p className="eyebrow mt-3 text-stone-400">{l}</p>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ---------- start: big index, then the action ---------- */}
      <section className="grid gap-10 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-5">
          <p aria-hidden className="numeral text-[7rem] leading-none text-fusion sm:text-[9rem]">01</p>
          <h2 className="headline">Start with your resume.</h2>
          <p className="muted max-w-sm">Paste it or upload a PDF or DOCX. It stays in this browser until you sign in.</p>
        </div>
        <div className="card p-6 sm:p-8 lg:col-span-7 lg:mt-24">
          <HomeResume />
        </div>
      </section>

      {/* ---------- what's inside: an editorial index ---------- */}
      <section aria-labelledby="inside-h" className="space-y-6">
        <div className="flex items-end justify-between gap-6">
          <h2 id="inside-h" className="title">Everything that comes after the gap.</h2>
          <p className="muted hidden sm:block">Five tools, one profile.</p>
        </div>
        <ul className="divide-y divide-fusion border-y border-fusion">
          {FEATURES.map((f) => (
            <li key={f.href}>
              <Link href={f.href} className="group grid items-baseline gap-2 py-7 sm:grid-cols-12 sm:gap-6">
                <span className="numeral text-sm text-stone-400 sm:col-span-1">{f.n}</span>
                <span className="text-3xl font-semibold tracking-[-0.035em] transition group-hover:text-royal sm:col-span-4 sm:text-4xl">{f.title}</span>
                <span className="text-sm font-light leading-relaxed text-stone-500 sm:col-span-6">{f.line}</span>
                <span aria-hidden className="hidden text-right text-xl text-stone-400 transition group-hover:translate-x-1 group-hover:text-nitro sm:col-span-1 sm:block">→</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
