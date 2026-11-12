import { safeUrl } from "@/lib/calendar";
import type { Resource } from "@/lib/types";

export function ResourceList({ resources, skill }: { resources: Resource[]; skill: string }) {
  if (!resources.length) {
    return <p className="muted">We haven&apos;t curated resources for {skill} yet.</p>;
  }
  return (
    <div className="space-y-3">
      <h4 className="eyebrow">Learn {skill}</h4>
      <ul className="space-y-2">
        {resources.map((r) => (
          <li key={r.url}>
            <a
              href={safeUrl(r.url) ?? "#"} target="_blank" rel="noopener noreferrer"
              className="group block rounded-2xl bg-white p-4 ring-1 ring-fusion transition hover:ring-stone-400"
            >
              <span className="flex items-start justify-between gap-3">
                <span className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-stone group-hover:text-royal">{r.title}</span>
                <span aria-hidden className="text-stone-400 transition group-hover:translate-x-0.5 group-hover:text-nitro">↗</span>
              </span>
              <span className="muted mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium text-stone-600">{r.provider}</span>
                <span className="capitalize">{r.kind}</span>
                <span className="capitalize">{r.level}</span>
                {r.hours ? <span>~{r.hours} h</span> : null}
                <span className={r.cost === "free" ? "chip bg-royal-soft py-0.5 text-royal" : "capitalize"}>{r.cost}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
