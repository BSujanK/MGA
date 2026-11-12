import { JobsClient } from "./JobsClient";

export const metadata = { title: "Jobs · MGA" };

export default function JobsPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Jobs</h1>
        <p className="text-slate-600">Open roles for early-career tech candidates. Check your fit before you apply.</p>
      </header>
      <JobsClient />
    </div>
  );
}
