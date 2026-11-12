import { Suspense } from "react";
import { PageHeader } from "@/components/ui";
import { CalendarClient } from "./CalendarClient";

export const metadata = { title: "Calendar · MGA" };

export default function CalendarPage() {
  return (
    <div className="space-y-16">
      <PageHeader eyebrow="Calendar" title="Every date that matters." accent="In one place.">
        Applications, online assessments, interviews and hiring drives. Export to any calendar app.
      </PageHeader>
      <Suspense>
        <CalendarClient />
      </Suspense>
    </div>
  );
}
