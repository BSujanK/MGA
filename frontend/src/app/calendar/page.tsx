import { Suspense } from "react";
import { CalendarClient } from "./CalendarClient";

export const metadata = { title: "Calendar · MGA" };

export default function CalendarPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Calendar</h1>
        <p className="text-slate-600">Applications, online assessments, interviews and hiring drives in one place. Export to any calendar app.</p>
      </header>
      <Suspense>
        <CalendarClient />
      </Suspense>
    </div>
  );
}
