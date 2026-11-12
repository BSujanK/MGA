import { Suspense } from "react";
import { PrepClient } from "./PrepClient";

export const metadata = { title: "Prep kit · MGA" };

export default function PrepPage() {
  return (
    <div className="space-y-6">
      <header className="no-print">
        <h1 className="text-2xl font-bold text-slate-900">Prep kit</h1>
        <p className="text-slate-600">
          A week-by-week plan for one job: DSA, core subjects, the online assessment, interview questions and a project that closes your gaps.
        </p>
      </header>
      <Suspense>
        <PrepClient />
      </Suspense>
    </div>
  );
}
