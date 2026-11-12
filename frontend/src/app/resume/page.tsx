import { Suspense } from "react";
import { ResumeClient } from "./ResumeClient";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Resume tuner · MGA" };

export default function ResumePage() {
  return (
    <div className="space-y-16">
      <PageHeader eyebrow="Resume tuner" title="Your resume," accent="tuned to one job.">
        A short interview surfaces experience your resume leaves out. Then we reorder and polish it for one job.
        We never add a skill, tool or number you didn&apos;t give us.
      </PageHeader>
      <Suspense>
        <ResumeClient />
      </Suspense>
    </div>
  );
}
