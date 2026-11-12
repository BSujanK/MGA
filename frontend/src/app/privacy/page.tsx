import Link from "next/link";

export const metadata = { title: "Privacy · MGA" };

const INDEX = [
  { id: "no-account", n: "01", label: "Without an account" },
  { id: "stored", n: "02", label: "What we store" },
  { id: "why", n: "03", label: "Why" },
  { id: "ai", n: "04", label: "AI analysis" },
  { id: "control", n: "05", label: "Your control" },
];

const LIST = "list-outside list-disc space-y-3 pl-5 marker:text-stone-400";

/** One long-read section: a big faded index numeral hangs in the margin on desktop. */
function Block({ id, n, title, children }: { id: string; n: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="relative scroll-mt-28 space-y-5 border-t border-fusion pt-8">
      <div className="flex items-start justify-between gap-6">
        <h2 id={`${id}-h`} className="title max-w-[16ch]">{title}</h2>
        <span aria-hidden className="numeral -mt-2 select-none text-[4.5rem] font-extralight leading-none text-fusion">{n}</span>
      </div>
      <div className="relative space-y-4 text-[0.9375rem] leading-[1.8] text-stone-700">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <article className="space-y-20">
      <header className="rise grid gap-8 pt-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-9">
          <p className="eyebrow flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-nitro" aria-hidden />Privacy notice</p>
          <h1 className="headline">
            What MGA keeps,
            <span className="block font-extralight text-stone-400">and why.</span>
          </h1>
          <p className="lede max-w-[65ch]">
            A resume is personal data. This page says, in plain language, what MGA keeps and why. It describes what the app does today.
          </p>
          <p className="inline-flex items-center gap-2.5 rounded-full bg-nitro-soft px-4 py-2 text-[0.8125rem] font-medium text-[#c2410c]">
            <span className="h-1.5 w-1.5 rounded-full bg-nitro" aria-hidden />
            This notice is a draft and will be reviewed before launch.
          </p>
        </div>
      </header>

      <div className="grid gap-12 lg:grid-cols-12 lg:gap-8">
        {/* Sticky in-page index (desktop) */}
        <nav aria-label="On this page" className="no-print hidden lg:col-span-3 lg:block">
          <ol className="sticky top-28 space-y-1">
            <li className="eyebrow pb-3">On this page</li>
            {INDEX.map((i) => (
              <li key={i.id}>
                <a href={`#${i.id}`} className="group flex items-baseline gap-3 rounded-full py-1.5 text-[0.8125rem] text-stone-500 transition hover:text-stone">
                  <span className="numeral text-[0.6875rem] text-stone-400 group-hover:text-nitro">{i.n}</span>
                  {i.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="space-y-16 lg:col-span-8 lg:col-start-5 lg:max-w-[65ch] xl:col-span-7 xl:col-start-5 xl:max-w-none">
          <div className="max-w-[65ch] space-y-16">
            <Block id="no-account" n="01" title="Without an account">
              <p>
                You can use MGA without signing in. Your resume, skill corrections, interview answers, prep progress and calendar then stay in
                this browser (local storage). When you run an analysis, the text it needs is sent to the MGA server to produce the result.
              </p>
            </Block>

            <Block id="stored" n="02" title="What we store if you create an account">
              <ul className={LIST}>
                <li>Your email address (and your name, if you sign in with Google), and the time you agreed to this notice.</li>
                <li>Your resume text and skill corrections. The resume is encrypted at rest.</li>
                <li>Your interview answers and prep progress for the jobs you work on.</li>
                <li>Your calendar events (applications, assessments, interviews).</li>
                <li>Reports you choose to save.</li>
                <li>A sign-in session, kept in a cookie that browser scripts cannot read (httpOnly), so you stay signed in on that device.</li>
              </ul>
            </Block>

            <Block id="why" n="03" title="Why">
              <p>
                Only to run MGA for you: to compare your skills with jobs, tune your resume, build prep kits, and keep your data the same
                on every device you use. We do not share your data with employers, and we do not sell it.
              </p>
            </Block>

            <Block id="ai" n="04" title="AI analysis">
              <p>
                MGA works with plain rules and no AI. When AI analysis is switched on for the service, parts of your resume and answers are sent
                to Anthropic&apos;s Claude to help read them, and the result is mapped back onto MGA&apos;s own skill list. When it is off, nothing goes to an AI provider.
              </p>
            </Block>

            <Block id="control" n="05" title="Your control">
              <ul className={LIST}>
                <li>Download everything we hold about you as a JSON file, any time, from <Link href="/account" className="font-medium text-royal underline underline-offset-2">your account page</Link>.</li>
                <li>Delete your account there too. This removes your profile, answers, calendar, saved reports and sessions, and cannot be undone.</li>
                <li>Sign out on this device, or on all devices.</li>
                <li>Signing out clears your resume and other personal data from this browser.</li>
              </ul>
            </Block>

            <p className="muted border-t border-fusion pt-8">
              Questions about this notice? Contact details will be added here before launch.
            </p>
          </div>
        </div>
      </div>
    </article>
  );
}
