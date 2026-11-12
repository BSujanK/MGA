import Link from "next/link";

export const metadata = { title: "Privacy · MGA" };

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-slate-900">Privacy notice</h1>
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">This notice is a draft and will be reviewed before launch.</p>
        <p className="text-slate-600">
          A resume is personal data. This page says, in plain language, what MGA keeps and why. It describes what the app does today.
        </p>
      </header>

      <section className="card space-y-2 p-5" aria-labelledby="no-account">
        <h2 id="no-account" className="font-semibold text-slate-900">Without an account</h2>
        <p className="text-sm text-slate-700">
          You can use MGA without signing in. Your resume, skill corrections, interview answers, prep progress and calendar then stay in
          this browser (local storage). When you run an analysis, the text it needs is sent to the MGA server to produce the result.
        </p>
      </section>

      <section className="card space-y-2 p-5" aria-labelledby="stored">
        <h2 id="stored" className="font-semibold text-slate-900">What we store if you create an account</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>Your email address (and your name, if you sign in with Google), and the time you agreed to this notice.</li>
          <li>Your resume text and skill corrections. The resume is encrypted at rest.</li>
          <li>Your interview answers and prep progress for the jobs you work on.</li>
          <li>Your calendar events (applications, assessments, interviews).</li>
          <li>Reports you choose to save.</li>
          <li>A sign-in session, kept in a cookie that browser scripts cannot read (httpOnly), so you stay signed in on that device.</li>
        </ul>
      </section>

      <section className="card space-y-2 p-5" aria-labelledby="why">
        <h2 id="why" className="font-semibold text-slate-900">Why</h2>
        <p className="text-sm text-slate-700">
          Only to run MGA for you: to compare your skills with jobs, tune your resume, build prep kits, and keep your data the same
          on every device you use. We do not share your data with employers, and we do not sell it.
        </p>
      </section>

      <section className="card space-y-2 p-5" aria-labelledby="ai">
        <h2 id="ai" className="font-semibold text-slate-900">AI analysis</h2>
        <p className="text-sm text-slate-700">
          MGA works with plain rules and no AI. When AI analysis is switched on for the service, parts of your resume and answers are sent
          to Anthropic&apos;s Claude to help read them, and the result is mapped back onto MGA&apos;s own skill list. When it is off, nothing goes to an AI provider.
        </p>
      </section>

      <section className="card space-y-2 p-5" aria-labelledby="control">
        <h2 id="control" className="font-semibold text-slate-900">Your control</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>Download everything we hold about you as a JSON file, any time, from <Link href="/account" className="font-medium text-indigo-700 underline">your account page</Link>.</li>
          <li>Delete your account there too. This removes your profile, answers, calendar, saved reports and sessions, and cannot be undone.</li>
          <li>Sign out on this device, or on all devices.</li>
          <li>Signing out clears your resume and other personal data from this browser.</li>
        </ul>
      </section>

      <p className="text-sm text-slate-500">
        Questions about this notice? Contact details will be added here before launch.
      </p>
    </article>
  );
}
