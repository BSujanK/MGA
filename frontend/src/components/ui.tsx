import type { GapStatus, Importance } from "@/lib/types";

export const STATUS: Record<GapStatus, { label: string; hint: string; chip: string; bar: string; dot: string }> = {
  strong: { label: "Strong", hint: "You meet the level asked", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200", bar: "bg-emerald-500", dot: "bg-emerald-500" },
  partial: { label: "Partial", hint: "You have it, below the level asked", chip: "bg-amber-50 text-amber-800 ring-amber-200", bar: "bg-amber-500", dot: "bg-amber-500" },
  transferable: { label: "Transferable", hint: "A related skill gets you part of the way", chip: "bg-sky-50 text-sky-700 ring-sky-200", bar: "bg-sky-500", dot: "bg-sky-500" },
  missing: { label: "Missing", hint: "No evidence yet", chip: "bg-rose-50 text-rose-700 ring-rose-200", bar: "bg-rose-500", dot: "bg-rose-500" },
};

export const LEVEL_NAMES = ["None", "Aware", "Basic", "Working", "Strong", "Expert"];

export function levelName(level: number) {
  return LEVEL_NAMES[Math.max(0, Math.min(5, Math.round(level)))];
}

export function StatusChip({ status }: { status: GapStatus }) {
  const s = STATUS[status];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${s.chip}`}>{s.label}</span>;
}

export function ImportanceChip({ importance }: { importance: Importance }) {
  return importance === "must" ? (
    <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">Must-have</span>
  ) : (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">Nice-to-have</span>
  );
}

/** Two-layer bar: the candidate's level against the level the job asks for. */
export function LevelBar({ have, need, status }: { have: number; need: number; status: GapStatus }) {
  const pct = (v: number) => `${Math.min(100, (v / 5) * 100)}%`;
  return (
    <div className="relative h-2.5 w-full rounded-full bg-slate-100" role="img" aria-label={`Your level ${have.toFixed(1)} of 5; required ${need.toFixed(1)}`}>
      <div className={`absolute inset-y-0 left-0 rounded-full ${STATUS[status].bar}`} style={{ width: pct(have) }} />
      <div className="absolute -top-1 h-4.5 w-0.5 rounded bg-slate-900" style={{ left: pct(need) }} title={`Required: ${levelName(need)}`} />
    </div>
  );
}

export function ReadinessRing({ value, label, size = 120 }: { value: number; label: string; size?: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const color = value >= 75 ? "#10b981" : value >= 50 ? "#f59e0b" : "#f43f5e";
  return (
    <figure className="flex flex-col items-center">
      <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={`${label}: ${Math.round(value)}%`}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="#e2e8f0" strokeWidth="12" />
        <circle
          cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={`${(c * value) / 100} ${c}`} transform="rotate(-90 60 60)"
        />
        <text x="60" y="66" textAnchor="middle" className="fill-slate-900 text-[26px] font-bold">{Math.round(value)}%</text>
      </svg>
      <figcaption className="mt-1 text-xs font-medium text-slate-500">{label}</figcaption>
    </figure>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{message}</div>;
}

export function Spinner({ label = "Working…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />
      {label}
    </div>
  );
}

export function hoursLabel(h: number) {
  if (h <= 0) return "Ready";
  if (h < 1.5) return "~1 hour";
  return `~${Math.round(h)} hours`;
}
