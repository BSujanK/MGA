"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  safeUrl,
  type CalEvent, type EventKind, KINDS, addDays, calendarStore, daysBetween, googleCalendarUrl, monthGrid, newId,
  parseISODate, sortEvents, toICS, toISODate,
} from "@/lib/calendar";
import { Section } from "@/components/ui";

const BLANK = (date: string): CalEvent => ({ id: "", kind: "application", title: "", date, time: "", remindDays: 1 });

function download(name: string, ics: string) {
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function rel(e: CalEvent, today: string) {
  const d = daysBetween(today, e.date);
  return d === 0 ? "today" : d === 1 ? "tomorrow" : d === -1 ? "yesterday" : d > 0 ? `in ${d} days` : `${-d} days ago`;
}

function when(e: CalEvent, today: string, relative = true) {
  const date = parseISODate(e.date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  return `${date}${e.time ? `, ${e.time}` : ""}${relative ? ` · ${rel(e, today)}` : ""}`;
}

function KindChip({ kind }: { kind: EventKind }) {
  return <span className={`chip ring-1 ring-inset ${KINDS[kind].chip}`}>{KINDS[kind].label}</span>;
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
  const next = upcoming[0];
  const then = soon.filter((e) => e.id !== next?.id);

  function save(e: CalEvent) {
    const clean = { ...e, title: e.title.trim(), id: e.id || newId() };
    setEvents((prev) => (prev.some((p) => p.id === clean.id) ? prev.map((p) => (p.id === clean.id ? clean : p)) : [...prev, clean]));
    setForm(null);
  }
  const remove = (id: string) => setEvents((prev) => prev.filter((p) => p.id !== id));
  const toggleDone = (id: string) => setEvents((prev) => prev.map((p) => (p.id === id ? { ...p, done: !p.done } : p)));

  const row = (e: CalEvent) => {
    const d = parseISODate(e.date);
    const link = safeUrl(e.url);
    return (
      <li key={e.id} className={`grid gap-4 px-5 py-6 sm:grid-cols-12 sm:gap-6 sm:px-8 ${e.done ? "opacity-55" : ""}`}>
        <div className="flex items-baseline gap-3 sm:col-span-2 sm:block">
          <p className="numeral text-5xl leading-none">{d.getDate()}</p>
          <p className="eyebrow sm:mt-2">{d.toLocaleDateString("en-IN", { month: "short" })} · {d.toLocaleDateString("en-IN", { weekday: "short" })}</p>
        </div>
        <div className="min-w-0 space-y-2 sm:col-span-5">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <KindChip kind={e.kind} />
            <span className={`text-lg font-semibold tracking-[-0.02em] ${e.done ? "line-through" : ""}`}>{e.title}</span>
            {e.company && <span className="muted">· {e.company}</span>}
          </p>
          <p className="muted">{when(e, today)}{e.remindDays > 0 ? ` · reminder ${e.remindDays} day${e.remindDays > 1 ? "s" : ""} before` : ""}</p>
          {e.notes && <p className="whitespace-pre-wrap text-[0.9375rem] font-light text-stone-600">{e.notes}</p>}
          {link && <a href={link} target="_blank" rel="noopener noreferrer" className="inline-block text-sm font-medium text-royal underline underline-offset-2">Open link ↗</a>}
        </div>
        <div className="flex flex-wrap content-start gap-1.5 text-sm sm:col-span-5 sm:justify-end">
          <button type="button" className="btn-ghost px-3 py-1.5" onClick={() => toggleDone(e.id)}>{e.done ? "Not done" : "Done"}</button>
          <button type="button" className="btn-ghost px-3 py-1.5" onClick={() => setForm(e)}>Edit</button>
          <a className="btn-ghost px-3 py-1.5" href={googleCalendarUrl(e)} target="_blank" rel="noopener noreferrer">Google Calendar ↗</a>
          <button type="button" className="btn-ghost px-3 py-1.5" onClick={() => download(`${e.title.replace(/[^A-Za-z0-9]+/g, "_") || "event"}.ics`, toICS([e]))}>.ics</button>
          <button type="button" className="btn-ghost px-3 py-1.5 text-redline" onClick={() => remove(e.id)}>Delete</button>
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-20">
      {/* ---------- next up: the date dominates ---------- */}
      {next ? (
        <section className="surface-dark relative overflow-hidden" aria-labelledby="soon-h" role="status">
          <div className="grid lg:grid-cols-12">
            <div className="flex items-end gap-6 px-7 pt-9 sm:px-12 sm:pt-12 lg:col-span-6">
              <div>
                <h2 id="soon-h" className="eyebrow flex items-center gap-2 text-stone-400"><span className="h-1.5 w-1.5 rounded-full bg-nitro" aria-hidden />Coming up</h2>
                {/* Oversized day, cropped by the block's bottom edge on purpose. */}
                <p aria-hidden className="numeral -mb-[0.12em] mt-6 text-[11rem] leading-[0.78] sm:text-[17rem]">{parseISODate(next.date).getDate()}</p>
              </div>
              <div aria-hidden className="space-y-1 pb-8 sm:pb-12">
                <p className="text-xl font-extralight tracking-[-0.02em] text-stone-400 sm:text-2xl">{parseISODate(next.date).toLocaleDateString("en-IN", { month: "long" })}</p>
                <p className="eyebrow text-stone-400">{parseISODate(next.date).toLocaleDateString("en-IN", { weekday: "long" })}</p>
              </div>
            </div>
            <div className="space-y-8 border-t border-stone-700 px-7 py-9 sm:px-12 sm:py-12 lg:col-span-6 lg:border-l lg:border-t-0">
              <div className="space-y-4">
                <KindChip kind={next.kind} />
                <p className="text-3xl font-semibold leading-[1.05] tracking-[-0.03em] sm:text-4xl">{next.title}</p>
                <p className="text-[0.9375rem] font-light text-stone-400">
                  {next.company ? `${next.company} · ` : ""}{when(next, today, false)}
                </p>
                <p className="numeral text-2xl text-nitro">{rel(next, today)}</p>
              </div>
              {then.length > 0 && (
                <div className="space-y-3 border-t border-stone-700 pt-5">
                  <p className="eyebrow text-stone-400">Then</p>
                  <ul className="space-y-2 text-[0.9375rem]">
                    {then.map((e) => (
                      <li key={e.id} className="flex items-baseline justify-between gap-4">
                        <span className="min-w-0 truncate font-medium">{e.title}</span>
                        <span className="shrink-0 text-stone-400">{when(e, today)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </section>
      ) : (
        <section className="panel flex flex-col gap-3 px-7 py-12 sm:px-12 sm:py-16">
          <p className="eyebrow">Coming up</p>
          <p className="headline">Nothing yet.<span className="block font-extralight text-stone-400">Add your first date.</span></p>
        </section>
      )}

      <div className="space-y-10">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary" onClick={() => setForm(BLANK(today))}>Add event</button>
          <button type="button" className="btn-ghost" disabled={!events.length} onClick={() => download("mga-calendar.ics", toICS(sorted))}>
            Export all (.ics)
          </button>
          <div className="ml-auto flex rounded-full bg-fusion-light p-1 text-sm" role="tablist" aria-label="Calendar view">
            {(["list", "month"] as const).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
                className={`rounded-full px-4 py-1.5 font-medium transition ${view === v ? "bg-white text-stone shadow-sm" : "text-stone-500 hover:text-stone"}`}>
                {v === "list" ? "List" : "Month"}
              </button>
            ))}
          </div>
        </div>

        {form && <EventForm value={form} onCancel={() => setForm(null)} onSave={save} />}

        {view === "list" ? (
          <div className="space-y-16">
            <Section index="01" title="Upcoming" id="up-h">
              {upcoming.length ? <ul className="card divide-y divide-fusion-light overflow-hidden">{upcoming.map(row)}</ul> : (
                <p className="muted">Nothing scheduled. Add your applications, online assessments and interviews, or use &quot;Add to calendar&quot; on the Jobs page.</p>
              )}
            </Section>
            {past.length > 0 && (
              <Section index="02" title="Done and past" id="past-h">
                <ul className="card divide-y divide-fusion-light overflow-hidden">{past.map(row)}</ul>
              </Section>
            )}
          </div>
        ) : (
          <MonthView month={month} setMonth={setMonth} today={today} events={sorted}
            onDay={(date) => setForm(BLANK(date))} onEvent={(e) => setForm(e)} />
        )}
      </div>
      <p className="muted max-w-xl">
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
  const first = parseISODate(`${month}-01`);
  const label = first.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const arrow = "grid h-10 w-10 place-items-center rounded-full bg-white text-lg text-stone ring-1 ring-fusion transition hover:ring-stone-400 active:scale-95";

  return (
    <section className="card overflow-hidden" aria-label={`Calendar for ${label}`}>
      <div className="flex items-center justify-between gap-4 px-5 py-6 sm:px-8">
        <h2 className="title">
          {first.toLocaleDateString("en-IN", { month: "long" })}
          <span className="ml-2.5 font-extralight text-stone-400">{first.getFullYear()}</span>
          <span className="sr-only">{label}</span>
        </h2>
        <div className="flex gap-2">
          <button type="button" className={arrow} onClick={() => shift(-1)} aria-label="Previous month">←</button>
          <button type="button" className={arrow} onClick={() => shift(1)} aria-label="Next month">→</button>
        </div>
      </div>
      <div className="grid grid-cols-7 border-y border-fusion-light">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="eyebrow py-3 text-center !tracking-[0.12em]">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {weeks.flat().map((day, i) => {
          const inMonth = day.slice(0, 7) === month;
          const isToday = day === today;
          const list = byDay.get(day) ?? [];
          return (
            <div key={day} className={`min-h-[4.5rem] border-fusion-light p-1 sm:min-h-32 sm:p-2 ${i % 7 !== 6 ? "border-r" : ""} ${i < weeks.length * 7 - 7 ? "border-b" : ""} ${inMonth ? "bg-white" : "bg-whiteout"}`}>
              <button type="button" onClick={() => onDay(day)} aria-label={`Add event on ${day}`}
                className={`mb-1 grid h-7 w-7 place-items-center rounded-full text-[0.8125rem] font-medium tabular-nums transition sm:h-8 sm:w-8 sm:text-sm ${isToday ? "bg-nitro font-semibold text-white" : inMonth ? "text-stone hover:bg-fusion-light" : "text-stone-400 hover:bg-fusion-light"}`}>
                {Number(day.slice(8))}
              </button>
              <ul className="flex flex-wrap gap-0.5 sm:flex-col sm:flex-nowrap sm:gap-0.5">
                {list.map((e) => (
                  <li key={e.id} className="min-w-0 sm:w-full">
                    <button type="button" onClick={() => onEvent(e)} title={e.title}
                      className={`flex w-full items-center gap-1.5 rounded-md p-0.5 text-left text-[0.75rem] font-medium leading-tight transition hover:bg-fusion-50 sm:px-1.5 sm:py-1 ${e.done ? "text-stone-400 line-through" : "text-stone-700"}`}>
                      <span className={`h-2 w-2 shrink-0 rounded-full ${KINDS[e.kind].dot} ${e.kind === "other" ? "ring-1 ring-inset ring-stone-400/40" : ""}`} />
                      <span className="sr-only min-w-0 truncate sm:not-sr-only">{e.time ? <span className="mr-1 font-normal text-stone-400">{e.time}</span> : null}{e.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-2 border-t border-fusion-light px-5 py-4 sm:px-8" aria-hidden>
        {Object.values(KINDS).map((k) => (
          <li key={k.label} className="muted flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${k.dot}`} />{k.label}</li>
        ))}
      </ul>
    </section>
  );
}

function EventForm({ value, onSave, onCancel }: { value: CalEvent; onSave: (e: CalEvent) => void; onCancel: () => void }) {
  const [e, setE] = useState(value);
  const set = (patch: Partial<CalEvent>) => setE((p) => ({ ...p, ...patch }));
  return (
    <form className="panel grid gap-5 p-6 sm:p-8 md:grid-cols-2" aria-label={value.id ? "Edit event" : "Add event"}
      onSubmit={(ev) => { ev.preventDefault(); if (e.title.trim() && e.date) onSave(e); }}>
      <div className="flex items-baseline justify-between gap-4 md:col-span-2">
        <p className="title">{value.id ? "Edit event" : "New event"}</p>
        <span className={`h-2.5 w-2.5 rounded-full ${KINDS[e.kind].dot}`} aria-hidden />
      </div>
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
      <div className="flex gap-2 pt-2 md:col-span-2">
        <button type="submit" className="btn-primary" disabled={!e.title.trim() || !e.date}>{value.id ? "Save changes" : "Add to calendar"}</button>
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
