"use client";

import { useRouter } from "next/navigation";
import { ResumeInput } from "@/components/ResumeInput";
import { useProfile } from "@/lib/profile";

export function HomeResume() {
  const router = useRouter();
  const { hasProfile } = useProfile();
  return (
    <div className="space-y-3">
      <ResumeInput compact onSaved={() => router.push("/analyze")} />
      {hasProfile && (
        <button type="button" className="btn-primary w-full" onClick={() => router.push("/analyze")}>
          Continue to job fit →
        </button>
      )}
    </div>
  );
}
