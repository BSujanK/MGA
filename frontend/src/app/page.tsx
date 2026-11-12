import Link from "next/link";
import { HomeResume } from "./HomeResume";

const FEATURES = [
  { title: "Job fit, skill by skill", body: "Paste any posting. See every skill it asks for marked Strong, Partial, Transferable or Missing, with the evidence and the hours to close it.", href: "/analyze" },
  { title: "The whole market", body: "What do SDE-1 roles in Bengaluru actually ask for? See demand across postings and which of your gaps unlock the most jobs.", href: "/market" },
  { title: "A plan to close it", body: "Every gap comes with curated, mostly free resources picked for your current level. No made-up links.", href: "/profile" },
  { title: "A resume tuned to the job", body: "Reorder and reword your real experience for one posting. Never invents skills you don't have.", href: "/resume" },
  { title: "Prep kits", body: "DSA plan, online assessment patterns, aptitude, culture questions and a project that closes your gaps.", href: "/prep" },
  { title: "Your hiring calendar", body: "Applications, OAs and interviews in one place, exportable to Google Calendar.", href: "/calendar" },
];

export default function Home() {
  return (
    <div className="space-y-12">
      <section className="grid gap-8 lg:grid-cols-2 lg:items-center">
        <div className="space-y-5">
          <p className="inline-block rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">For students and freshers in tech</p>
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
            Know exactly what stands between you and the job.
          </h1>
          <p className="text-lg text-slate-600">
            MGA compares your skills with the job you want and with the whole job market, one skill at a time.
            No &ldquo;not eligible&rdquo;. Just what&apos;s missing, how long it takes, and where to learn it.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/analyze" className="btn-primary px-5 py-3 text-base">Check my fit for a job</Link>
            <Link href="/market" className="btn-ghost px-5 py-3 text-base">See the market</Link>
          </div>
        </div>
        <div className="card p-5">
          <h2 className="mb-3 font-bold text-slate-900">Start with your resume</h2>
          <HomeResume />
        </div>
      </section>
      <section aria-labelledby="features-h">
        <h2 id="features-h" className="sr-only">Features</h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <li key={f.title}>
              <Link href={f.href} className="card block h-full p-5 hover:border-indigo-300">
                <h3 className="font-semibold text-slate-900">{f.title}</h3>
                <p className="mt-2 text-sm text-slate-600">{f.body}</p>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
