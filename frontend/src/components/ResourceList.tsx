import { safeUrl } from "@/lib/calendar";
import type { Resource } from "@/lib/types";

export function ResourceList({ resources, skill }: { resources: Resource[]; skill: string }) {
  if (!resources.length) {
    return <p className="text-slate-500">We haven&apos;t curated resources for {skill} yet.</p>;
  }
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Learn {skill}</h4>
      <ul className="space-y-2">
        {resources.map((r) => (
          <li key={r.url}>
            <a href={safeUrl(r.url) ?? "#"} target="_blank" rel="noopener noreferrer" className="block rounded-xl border border-slate-200 bg-white p-3 hover:border-indigo-300 hover:shadow-sm">
              <span className="font-medium text-indigo-700">{r.title}</span>
              <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                <span>{r.provider}</span>
                <span className="capitalize">{r.kind}</span>
                <span className="capitalize">{r.level}</span>
                <span className={r.cost === "free" ? "font-semibold text-emerald-700" : ""}>{r.cost}</span>
                {r.hours ? <span>~{r.hours} h</span> : null}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
