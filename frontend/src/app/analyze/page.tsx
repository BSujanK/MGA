import { Suspense } from "react";
import { AnalyzeClient } from "./AnalyzeClient";

export const metadata = { title: "Job fit · MGA" };

export default function AnalyzePage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Job fit</h1>
        <p className="text-slate-600">Pick a job or paste any posting. We&apos;ll compare it with your resume, skill by skill.</p>
      </header>
      <Suspense>
        <AnalyzeClient />
      </Suspense>
    </div>
  );
}
