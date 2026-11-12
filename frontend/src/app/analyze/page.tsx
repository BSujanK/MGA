import { Suspense } from "react";
import { AnalyzeClient } from "./AnalyzeClient";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Job fit · MGA" };

export default function AnalyzePage() {
  return (
    <div className="space-y-16">
      <PageHeader eyebrow="Job fit" title="Your resume," accent="against one job.">
        Pick a job or paste any posting. We&apos;ll compare it with your resume, skill by skill.
      </PageHeader>
      <Suspense>
        <AnalyzeClient />
      </Suspense>
    </div>
  );
}
