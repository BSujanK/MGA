"use client";

import { createLocalStore } from "./store";

export type EventKind = "application" | "oa" | "interview" | "deadline" | "drive" | "other";

export const KINDS: Record<EventKind, { label: string; chip: string; dot: string }> = {
  application: { label: "Application", chip: "bg-royal-soft text-royal ring-royal/20", dot: "bg-royal" },
  oa: { label: "Online assessment", chip: "bg-nitro-soft text-[#c2410c] ring-nitro/25", dot: "bg-nitro" },
  interview: { label: "Interview", chip: "bg-stone text-whiteout ring-stone", dot: "bg-stone" },
  deadline: { label: "Deadline", chip: "bg-redline-soft text-redline ring-redline/20", dot: "bg-redline" },
  drive: { label: "Hiring drive", chip: "bg-fusion-light text-stone-700 ring-fusion", dot: "bg-stone-400" },
  other: { label: "Other", chip: "bg-fusion-50 text-stone-500 ring-fusion-light", dot: "bg-fusion" },
};

export interface CalEvent {
  id: string;
  kind: EventKind;
  title: string;
  date: string; // YYYY-MM-DD, local
  time?: string; // HH:MM, local; empty = all day
  durationMins?: number;
  company?: string;
  jobId?: string;
  url?: string;
  notes?: string;
  remindDays: number; // 0 = no reminder
  done?: boolean;
}

export const calendarStore = createLocalStore<CalEvent[]>("mga.calendar.v1", []);

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------- dates (local, no time zones involved) ----------

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s: string, n: number): string {
  const d = parseISODate(s);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseISODate(to).getTime() - parseISODate(from).getTime()) / 86_400_000);
}

/** Monday-first weeks covering the month that contains `month` (YYYY-MM). */
export function monthGrid(month: string): string[][] {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const offset = (first.getDay() + 6) % 7; // Monday = 0
  let day = toISODate(new Date(y, m - 1, 1 - offset));
  const weeks: string[][] = [];
  do {
    const week = [];
    for (let i = 0; i < 7; i++) {
      week.push(day);
      day = addDays(day, 1);
    }
    weeks.push(week);
  } while (parseISODate(day).getMonth() === m - 1);
  return weeks;
}

export function sortEvents(events: CalEvent[]): CalEvent[] {
  return [...events].sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
}

// ---------- .ics export (RFC 5545) ----------

/** Remove control characters (incl. CR/LF) so a value can never inject extra iCalendar lines. */
function clean(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f]/g, " ");
}

/** The URL only if it is a plain http(s) link; otherwise undefined. Use for every link rendered from data. */
export function safeUrl(u: string | null | undefined): string | undefined {
  if (!u) return undefined;
  try {
    const p = new URL(u.trim());
    return p.protocol === "http:" || p.protocol === "https:" ? p.href : undefined;
  } catch {
    return undefined;
  }
}

function esc(s: string): string {
  return s
    .split(/\r?\n/)
    .map((line) => clean(line).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,"))
    .join("\\n");
}

/** Fold lines longer than 75 octets, as the spec requires. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let len = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (len + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      len = 0;
    }
    cur += ch;
    len += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const compact = (date: string) => date.replace(/-/g, "");

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function endOf(e: CalEvent): { date: string; time: string } {
  const [h, m] = (e.time || "00:00").split(":").map(Number);
  const total = h * 60 + m + (e.durationMins ?? 60);
  return { date: addDays(e.date, Math.floor(total / 1440)), time: `${String(Math.floor((total % 1440) / 60)).padStart(2, "0")}${String(total % 60).padStart(2, "0")}00` };
}

function description(e: CalEvent): string {
  return [e.company && `Company: ${e.company}`, e.notes, safeUrl(e.url)].filter(Boolean).join("\n");
}

export function toICS(events: CalEvent[], now = new Date()): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//MGA//Job search calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${clean(e.id)}@mga`, `DTSTAMP:${stamp(now)}`);
    if (e.time) {
      const end = endOf(e);
      // Floating local time: shows at the same clock time wherever the candidate is.
      lines.push(`DTSTART:${compact(e.date)}T${e.time.replace(":", "")}00`, `DTEND:${compact(end.date)}T${end.time}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compact(e.date)}`, `DTEND;VALUE=DATE:${compact(addDays(e.date, 1))}`);
    }
    lines.push(`SUMMARY:${esc(`${KINDS[e.kind].label}: ${e.title}`)}`, `CATEGORIES:${esc(KINDS[e.kind].label)}`);
    const desc = description(e);
    if (desc) lines.push(`DESCRIPTION:${esc(desc)}`);
    const link = safeUrl(e.url);
    if (link) lines.push(`URL:${clean(link)}`);
    if (e.remindDays > 0) {
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(e.title)}`, `TRIGGER:-P${e.remindDays}D`, "END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** "Add to Google Calendar" link (Google's public event-template URL). Nothing is sent until the user saves it there. */
export function googleCalendarUrl(e: CalEvent): string {
  const dates = e.time
    ? `${compact(e.date)}T${e.time.replace(":", "")}00/${compact(endOf(e).date)}T${endOf(e).time}`
    : `${compact(e.date)}/${compact(addDays(e.date, 1))}`;
  const qs = new URLSearchParams({ action: "TEMPLATE", text: `${KINDS[e.kind].label}: ${e.title}`, dates, details: description(e) });
  return `https://calendar.google.com/calendar/render?${qs}`;
}
