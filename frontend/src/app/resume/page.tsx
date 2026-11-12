import { Suspense } from "react";
import { ResumeClient } from "./ResumeClient";

export const metadata = { title: "Resume tuner · MGA" };

export default function ResumePage() {
  return (
    <div className="space-y-6">
      <header className="no-print">
        <h1 className="text-2xl font-bold text-slate-900">Resume tuner</h1>
        <p className="text-slate-600">
          A short interview surfaces experience your resume leaves out. Then we reorder and polish it for one job.
          We never add a skill, tool or number you didn&apos;t give us.
        </p>
      </header>
      <Suspense>
        <ResumeClient />
      </Suspense>
    </div>
  );
}
