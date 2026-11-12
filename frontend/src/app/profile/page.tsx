import { ProfileClient } from "./ProfileClient";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "My skills · MGA" };

export default function ProfilePage() {
  return (
    <div className="space-y-16">
      <PageHeader eyebrow="Your profile" title="My skills." accent="Corrected by you.">
        What we read from your resume. Correct anything we got wrong. Your corrections are used in every report.
      </PageHeader>
      <ProfileClient />
    </div>
  );
}
