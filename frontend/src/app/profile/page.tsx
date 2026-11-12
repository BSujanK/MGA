import { ProfileClient } from "./ProfileClient";

export const metadata = { title: "My skills · MGA" };

export default function ProfilePage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">My skills</h1>
        <p className="text-slate-600">What we read from your resume. Correct anything we got wrong. Your corrections are used in every report.</p>
      </header>
      <ProfileClient />
    </div>
  );
}
