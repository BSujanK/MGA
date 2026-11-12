"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  safeUrl,
  type CalEvent, type EventKind, KINDS, addDays, calendarStore, daysBetween, googleCalendarUrl, monthGrid, newId,
  parseISODate, sortEvents, toICS, toISODate,
} from "@/lib/calendar";

const BLANK = (date: string): CalEvent => ({ id: "", kind: "application", title: "", date, time: "", remindDays: 1 });

function download(name: string, ics: string) {
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function when(e: CalEvent, today: string) {
  const d = daysBetween(today, e.date);
  const rel = d === 0 ? "today" : d === 1 ? "tomorrow" : d === -1 ? "yesterday" : d > 0 ? `in ${d} days` : `${-d} days ago`;
  const date = parseISODate(e.date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  return `${date}${e.time ? `, ${e.time}` : ""} · ${rel}`;
}

export function CalendarClient() {
  const params = useSearchParams();
  const router = useRouter();
  const [events, setEvents] = calendarStore.useStore();
  const [today] = useState(() => toISODate(new Date()));
  const [view, setView] = useState<"month" | "list">("list");
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [form, setForm] = useState<CalEvent | null>(null);

  // Prefill from links elsewhere in the app: /calendar?new=oa&title=…&job=…&url=…
  useEffect(() => {
    const kind = params.get("new") as EventKind | null;
    if (!kind) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time prefill from the URL
    setForm({
      ...BLANK(addDays(today, 7)),
      kind: kind in KINDS ? kind : "other",
      title: params.get("title") ?? "",
      company: params.get("company") ?? "",
      jobId: params.get("job") ?? undefined,
      url: safeUrl(params.get("url")) ?? "",
    });
    router.replace("/calendar");
  }, [params, router, today]);

  const sorted = useMemo(() => sortEvents(events), [events]);
  const upcoming = sorted.filter((e) => !e.done && daysBetween(today, e.date) >= 0);
  const soon = upcoming.filter((e) => daysBetween(today, e.date) <= Math.max(7, e.remindDays));
  const past = sorted.filter((e) => e.done || daysBetween(today, e.date) < 0).reverse();

  function save(e: CalEvent) {
    const clean = { ...e, title: e.title.trim(), id: e.id || newId() };
    setEvents((prev) => (prev.some((p) => p.id === clean.id) ? prev.map((p) => (p.id === clean.id ? clean : p)) : [...prev, clean]));
    setForm(null);
  }
  const remove = (id: string) => setEvents((prev) => prev.filter((p) => p.id !== id));
  const toggleDone = (id: string) => setEvents((prev) => prev.map((p) => (p.id === id ? { ...p, done: !p.done } : p)));

  const row = (e: CalEvent) => (
    <li key={e.id} className={`card flex flex-wrap items-start justify-between gap-3 p-4 ${e.done ? "opacity-60" : ""}`}>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${KINDS[e.kind].chip}`}>{KINDS[e.kind].label}</span>
          <span className={`font-semibold text-slate-900 ${e.done ? "line-through" : ""}`}>{e.title}</span>
          {e.company && <span className="text-sm text-slate-500">· {e.company}</span>}
        </p>
        <p className="mt-1 text-sm text-slate-600">{when(e, today)}{e.remindDays > 0 ? ` · reminder ${e.remindDays} day${e.remindDays > 1 ? "s" : ""} before` : ""}</p>
        {e.notes && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{e.notes}</p>}
        {safeUrl(e.url) && <a href={safeUrl(e.url)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-sm text-indigo-700 underline">Open link ↗</a>}
      </div>
      <div className="flex flex-wrap gap-1.5 text-sm">
        <button type="button" className="btn-ghost px-3 py-1" onClick={() => toggleDone(e.id)}>{e.done ? "Not done" : "Done"}</button>
        <button type="button" className="btn-ghost px-3 py-1" onClick={() => setForm(e)}>Edit</button>
        <a className="btn-ghost px-3 py-1" href={googleCalendarUrl(e)} target="_blank" rel="noopener noreferrer">Google Calendar ↗</a>
        <button type="button" className="btn-ghost px-3 py-1" onClick={() => download(`${e.title.replace(/[^A-Za-z0-9]+/g, "_") || "event"}.ics`, toICS([e]))}>.ics</button>
        <button type="button" className="btn-ghost px-3 py-1 text-rose-700" onClick={() => remove(e.id)}>Delete</button>
      </div>
    </li>
  );

  return (
    <div className="space-y-6">
      {soon.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4" aria-labelledby="soon-h" role="status">
          <h2 id="soon-h" className="font-semibold text-amber-900">Coming up</h2>
          <ul className="mt-1 space-y-0.5 text-sm text-amber-900">
            {soon.map((e) => <li key={e.id}><span className="font-medium">{e.title}</span> · {when(e, today)}</li>)}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary" onClick={() => setForm(BLANK(today))}>Add event</button>
        <button type="button" className="btn-ghost" disabled={!events.length} onClick={() => download("mga-calendar.ics", toICS(sorted))}>
          Export all (.ics)
        </button>
        <div className="ml-auto flex rounded-lg bg-slate-100 p-0.5 text-sm" role="tablist" aria-label="Calendar view">
          {(["list", "month"] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
              className={`rounded-md px-3 py-1 font-medium ${view === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}>
              {v === "list" ? "List" : "Month"}
            </button>
          ))}
        </div>
      </div>

      {form && <EventForm value={form} onCancel={() => setForm(null)} onSave={save} />}

      {view === "list" ? (
        <div className="space-y-6">
          <section aria-labelledby="up-h">
            <h2 id="up-h" className="mb-2 font-semibold text-slate-900">Upcoming</h2>
            {upcoming.length ? <ul className="space-y-2">{upcoming.map(row)}</ul> : (
              <p className="text-sm text-slate-600">Nothing scheduled. Add your applications, online assessments and interviews, or use &quot;Add to calendar&quot; on the Jobs page.</p>
            )}
          </section>
          {past.length > 0 && (
            <section aria-labelledby="past-h">
              <h2 id="past-h" className="mb-2 font-semibold text-slate-900">Done and past</h2>
              <ul className="space-y-2">{past.map(row)}</ul>
            </section>
          )}
        </div>
      ) : (
        <MonthView month={month} setMonth={setMonth} today={today} events={sorted}
          onDay={(date) => setForm(BLANK(date))} onEvent={(e) => setForm(e)} />
      )}
      <p className="text-xs text-slate-500">
        Your calendar is saved in this browser only. Reminders work once you import the .ics file or add events to Google Calendar.
      </p>
    </div>
  );
}

function MonthView({ month, setMonth, today, events, onDay, onEvent }: {
  month: string; setMonth: (m: string) => void; today: string; events: CalEvent[];
  onDay: (date: string) => void; onEvent: (e: CalEvent) => void;
}) {
  const weeks = monthGrid(month);
  const shift = (n: number) => {
    const d = parseISODate(`${month}-01`);
    d.setMonth(d.getMonth() + n);
    setMonth(toISODate(d).slice(0, 7));
  };
  const byDay = new Map<string, CalEvent[]>();
  for (const e of events) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  const label = parseISODate(`${month}-01`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  return (
    <section className="card overflow-hidden" aria-label={`Calendar for ${label}`}>
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <button type="button" className="btn-ghost px-3 py-1" onClick={() => shift(-1)} aria-label="Previous month">←</button>
        <h2 className="font-semibold text-slate-900">{label}</h2>
        <button type="button" className="btn-ghost px-3 py-1" onClick={() => shift(1)} aria-label="Next month">→</button>
      </div>
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-semibold text-slate-500">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="py-2">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {weeks.flat().map((day) => {
          const inMonth = day.slice(0, 7) === month;
          const list = byDay.get(day) ?? [];
          return (
            <div key={day} className={`min-h-24 border-b border-r border-slate-100 p-1.5 ${inMonth ? "bg-white" : "bg-slate-50"}`}>
              <button type="button" onClick={() => onDay(day)} aria-label={`Add event on ${day}`}
                className={`mb-1 grid h-6 w-6 place-items-center rounded-full text-xs ${day === today ? "bg-indigo-600 font-bold text-white" : inMonth ? "text-slate-700 hover:bg-slate-100" : "text-slate-400"}`}>
                {Number(day.slice(8))}
              </button>
              <ul className="space-y-0.5">
                {list.map((e) => (
                  <li key={e.id}>
                    <button type="button" onClick={() => onEvent(e)} title={e.title}
                      className={`flex w-full items-center gap-1 truncate rounded px-1 text-left text-[11px] hover:bg-slate-100 ${e.done ? "text-slate-400 line-through" : "text-slate-700"}`}>
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${KINDS[e.kind].dot}`} />
                      <span className="truncate">{e.time ? `${e.time} ` : ""}{e.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function EventForm({ value, onSave, onCancel }: { value: CalEvent; onSave: (e: CalEvent) => void; onCancel: () => void }) {
  const [e, setE] = useState(value);
  const set = (patch: Partial<CalEvent>) => setE((p) => ({ ...p, ...patch }));
  return (
    <form className="card grid gap-3 p-5 md:grid-cols-2" aria-label={value.id ? "Edit event" : "Add event"}
      onSubmit={(ev) => { ev.preventDefault(); if (e.title.trim() && e.date) onSave(e); }}>
      <div>
        <label htmlFor="ev-kind" className="label">Type</label>
        <select id="ev-kind" className="input" value={e.kind} onChange={(x) => set({ kind: x.target.value as EventKind })}>
          {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="ev-title" className="label">Title</label>
        <input id="ev-title" className="input" required value={e.title} onChange={(x) => set({ title: x.target.value })} placeholder="e.g. Coding round: SDE I" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="ev-date" className="label">Date</label>
          <input id="ev-date" type="date" className="input" required value={e.date} onChange={(x) => set({ date: x.target.value })} />
        </div>
        <div>
          <label htmlFor="ev-time" className="label">Time (optional)</label>
          <input id="ev-time" type="time" className="input" value={e.time ?? ""} onChange={(x) => set({ time: x.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="ev-company" className="label">Company</label>
          <input id="ev-company" className="input" value={e.company ?? ""} onChange={(x) => set({ company: x.target.value })} />
        </div>
        <div>
          <label htmlFor="ev-remind" className="label">Reminder</label>
          <select id="ev-remind" className="input" value={e.remindDays} onChange={(x) => set({ remindDays: Number(x.target.value) })}>
            {[0, 1, 2, 3, 7].map((d) => <option key={d} value={d}>{d === 0 ? "None" : `${d} day${d > 1 ? "s" : ""} before`}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="ev-url" className="label">Link (optional)</label>
        <input id="ev-url" type="url" className="input" value={e.url ?? ""} onChange={(x) => set({ url: x.target.value })} placeholder="https://…" />
      </div>
      <div>
        <label htmlFor="ev-notes" className="label">Notes</label>
        <textarea id="ev-notes" className="input" rows={2} value={e.notes ?? ""} onChange={(x) => set({ notes: x.target.value })} placeholder="Round details, what to revise…" />
      </div>
      <div className="flex gap-2 md:col-span-2">
        <button type="submit" className="btn-primary" disabled={!e.title.trim() || !e.date}>{value.id ? "Save changes" : "Add to calendar"}</button>
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
