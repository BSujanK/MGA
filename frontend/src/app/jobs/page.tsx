import { JobsClient } from "./JobsClient";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Jobs · MGA" };

export default function JobsPage() {
  return (
    <div className="space-y-16">
      <PageHeader eyebrow="Open roles · early-career tech" title="Jobs." accent="Closest first.">
        Open roles for early-career tech candidates. See how ready you already are, then check your fit before you apply.
      </PageHeader>
      <JobsClient />
    </div>
  );
}
