import { Suspense } from "react";
import { PageHeader } from "@/components/ui";
import { PrepClient } from "./PrepClient";

export const metadata = { title: "Prep kit · MGA" };

export default function PrepPage() {
  return (
    <div className="space-y-16">
      <PageHeader eyebrow="Prep kit" title="One job." accent="Week by week.">
        A plan for one job: DSA, core subjects, the online assessment, interview questions and a project that closes your gaps.
      </PageHeader>
      <Suspense>
        <PrepClient />
      </Suspense>
    </div>
  );
}
