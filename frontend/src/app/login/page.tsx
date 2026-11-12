import { Suspense } from "react";
import { LoginClient } from "./LoginClient";

export const metadata = { title: "Sign in · MGA" };

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-md space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Sign in</h1>
        <p className="text-slate-600">Save your resume, answers, prep progress and calendar so they follow you across devices. MGA still works without an account.</p>
      </header>
      <Suspense>
        <LoginClient />
      </Suspense>
    </div>
  );
}
