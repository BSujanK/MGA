import { AccountClient } from "./AccountClient";

export const metadata = { title: "Account · MGA" };

export default function AccountPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Your account</h1>
        <p className="text-slate-600">Your saved reports and your data controls.</p>
      </header>
      <AccountClient />
    </div>
  );
}
