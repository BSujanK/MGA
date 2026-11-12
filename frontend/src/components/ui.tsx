import type { ReactNode } from "react";
import type { GapStatus, Importance } from "@/lib/types";

/*
 * Status colours follow the palette: Royal = you have it, Nitro = partly,
 * Stone = a related skill carries you part of the way, Redline = missing.
 */
export const STATUS: Record<GapStatus, { label: string; hint: string; chip: string; bar: string; dot: string; text: string }> = {
  strong: { label: "Strong", hint: "You meet the level asked", chip: "bg-royal-soft text-royal", bar: "bg-royal", dot: "bg-royal", text: "text-royal" },
  partial: { label: "Partial", hint: "You have it, below the level asked", chip: "bg-nitro-soft text-[#c2410c]", bar: "bg-nitro", dot: "bg-nitro", text: "text-nitro" },
  transferable: { label: "Transferable", hint: "A related skill gets you part of the way", chip: "bg-fusion-light text-stone-700", bar: "bg-stone-500", dot: "bg-stone-500", text: "text-stone-600" },
  missing: { label: "Missing", hint: "No evidence yet", chip: "bg-redline-soft text-redline", bar: "bg-redline", dot: "bg-redline", text: "text-redline" },
};

export const LEVEL_NAMES = ["None", "Aware", "Basic", "Working", "Strong", "Expert"];

export function levelName(level: number) {
  return LEVEL_NAMES[Math.max(0, Math.min(5, Math.round(level)))];
}

export function StatusChip({ status }: { status: GapStatus }) {
  const s = STATUS[status];
  return (
    <span className={`chip ${s.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden />
      {s.label}
    </span>
  );
}

export function ImportanceChip({ importance }: { importance: Importance }) {
  return importance === "must" ? (
    <span className="chip bg-stone text-whiteout">Must-have</span>
  ) : (
    <span className="chip bg-fusion-50 text-stone-600 ring-1 ring-fusion-light">Nice-to-have</span>
  );
}

/** The candidate's level against the level asked; the gap between them is drawn in Nitro. */
export function LevelBar({ have, need, status }: { have: number; need: number; status: GapStatus }) {
  const pct = (v: number) => `${Math.min(100, (v / 5) * 100)}%`;
  const gap = Math.max(0, need - have);
  return (
    <div className="relative h-2 w-full rounded-full bg-fusion-light" role="img" aria-label={`Your level ${have.toFixed(1)} of 5; asked ${need.toFixed(1)}`}>
      {gap > 0 && (
        <div className="absolute inset-y-0 rounded-full bg-[repeating-linear-gradient(135deg,var(--color-nitro)_0_3px,transparent_3px_6px)] opacity-50"
          style={{ left: pct(have), width: pct(gap) }} />
      )}
      <div className={`absolute inset-y-0 left-0 rounded-full ${STATUS[status].bar}`} style={{ width: pct(have) }} />
      <div className="absolute -top-1.5 h-5 w-[3px] rounded-full bg-stone" style={{ left: `calc(${pct(need)} - 1.5px)` }} title={`Asked: ${levelName(need)}`} />
    </div>
  );
}

export function ReadinessRing({ value, label, size = 132, tone = "light" }: { value: number; label: string; size?: number; tone?: "light" | "dark" }) {
  const r = 54;
  const c = 2 * Math.PI * r;
  const color = value >= 75 ? "var(--color-royal)" : value >= 50 ? "var(--color-nitro)" : "var(--color-redline)";
  const track = tone === "dark" ? "rgb(255 255 255 / 0.12)" : "var(--color-fusion-light)";
  return (
    <figure className="flex flex-col items-center gap-2">
      <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={`${label}: ${Math.round(value)}%`}>
        <circle cx="60" cy="60" r={r} fill="none" stroke={track} strokeWidth="6" />
        <circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={`${(c * value) / 100} ${c}`} transform="rotate(-90 60 60)" />
        <text x="60" y="68" textAnchor="middle" fontSize="30" fontWeight="600" letterSpacing="-1.5"
          fill={tone === "dark" ? "#f7f7f4" : "#141413"}>{Math.round(value)}%</text>
      </svg>
      <figcaption className={`eyebrow ${tone === "dark" ? "text-stone-400" : ""}`}>{label}</figcaption>
    </figure>
  );
}

/** Page opening: small eyebrow, oversized headline, a lighter second line, small supporting copy. */
export function PageHeader({ eyebrow, title, accent, children, aside }: {
  eyebrow: string; title: ReactNode; accent?: ReactNode; children?: ReactNode; aside?: ReactNode;
}) {
  return (
    <header className="no-print grid gap-8 pb-4 pt-6 lg:grid-cols-12 lg:items-end">
      <div className="rise space-y-5 lg:col-span-8">
        <p className="eyebrow flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-nitro" aria-hidden />{eyebrow}</p>
        <h1 className="headline">
          {title}
          {accent && <span className="block font-extralight text-stone-400">{accent}</span>}
        </h1>
        {children && <div className="lede max-w-2xl">{children}</div>}
      </div>
      {aside && <div className="lg:col-span-4 lg:justify-self-end">{aside}</div>}
    </header>
  );
}

/** A numbered section with generous space above it. */
export function Section({ index, title, note, children, id }: { index?: string; title: string; note?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="space-y-6 pt-4" aria-labelledby={id}>
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-t border-fusion pt-6">
        <h2 id={id} className="flex items-baseline gap-3 text-xl font-semibold tracking-[-0.02em]">
          {index && <span className="numeral text-sm font-medium text-stone-400">{index}</span>}
          {title}
        </h2>
        {note && <p className="muted">{note}</p>}
      </div>
      {children}
    </section>
  );
}

/** Oversized number with a small label: the key fact on a screen. */
export function Stat({ value, label, tone = "stone", size = "lg" }: { value: ReactNode; label: string; tone?: "stone" | "royal" | "nitro" | "redline" | "light"; size?: "lg" | "xl" }) {
  const color = { stone: "text-stone", royal: "text-royal", nitro: "text-nitro", redline: "text-redline", light: "text-whiteout" }[tone];
  return (
    <div className="space-y-1">
      <p className={`numeral leading-none ${size === "xl" ? "text-7xl sm:text-8xl" : "text-5xl"} ${color}`}>{value}</p>
      <p className={`eyebrow ${tone === "light" ? "text-stone-400" : ""}`}>{label}</p>
    </div>
  );
}

/**
 * The MGA mark as a graphic: two blocks with the gap between them in Nitro.
 * Used as a visual metaphor for "the distance between you and the job".
 */
export function GapGlyph({ className = "", filled = 0.62 }: { className?: string; filled?: number }) {
  const w = 240 * filled;
  return (
    <svg viewBox="0 0 320 120" className={className} aria-hidden>
      <rect x="0" y="20" width={w} height="80" rx="18" fill="currentColor" />
      <rect x={w + 6} y="20" width={240 - w - 12} height="80" rx="18" fill="none" stroke="var(--color-nitro)" strokeWidth="3" strokeDasharray="8 7" />
      <rect x="246" y="20" width="74" height="80" rx="18" fill="var(--color-royal)" />
    </svg>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-2xl bg-redline-soft px-4 py-3 text-sm text-redline">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-redline" aria-hidden />
      {message}
    </div>
  );
}

export function Spinner({ label = "Working…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-stone-500" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-fusion border-t-royal" />
      {label}
    </div>
  );
}

export function hoursLabel(h: number) {
  if (h <= 0) return "Ready";
  if (h < 1.5) return "~1 hour";
  return `~${Math.round(h)} hours`;
}
