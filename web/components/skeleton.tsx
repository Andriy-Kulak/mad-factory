import { Shell } from "./shell";

/*
 * Loading placeholder shaped like the page it stands in for, so opening a tab responds at once while its data
 * loads. Use it from a route's loading.tsx: `export default () => <PageSkeleton title="…" stats={4} body="table" />`.
 */

const BLOCK = "bg-line-2 rounded-[3px] animate-pulse";

export function PageSkeleton({ title, stats = 4, body = "table", sidebar = false }: { title: string; stats?: number; body?: "table" | "grid" | "cards" | "chart"; sidebar?: boolean }) {
  const content =
    body === "table" ? (
      <div className="card p-4 flex flex-col gap-3">
        {Array.from({ length: 8 }, (_, i) => <div key={i} className={`${BLOCK} h-4`} style={{ width: `${96 - (i % 3) * 12}%`, animationDelay: `${i * 50}ms` }} />)}
      </div>
    ) : body === "chart" ? (
      <div className="card h-[320px] p-4"><div className={`${BLOCK} h-full`} /></div>
    ) : (
      <div className={`grid gap-4 ${body === "grid" ? "grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5" : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"}`}>
        {Array.from({ length: body === "grid" ? 10 : 6 }, (_, i) => (
          <div key={i} className={body === "cards" ? "card p-3" : ""}>
            <div className={`${BLOCK} ${body === "grid" ? "aspect-[9/16] rounded-[6px]" : "aspect-[4/5]"}`} style={{ animationDelay: `${i * 60}ms` }} />
            <div className={`${BLOCK} h-3.5 w-4/5 mt-2.5`} />
            <div className={`${BLOCK} h-3 w-1/2 mt-2`} />
          </div>
        ))}
      </div>
    );
  return (
    <Shell title={title} subtitle="Loading…">
      {stats > 0 && (
        <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: `repeat(${Math.min(stats, 6)}, minmax(0, 1fr))` }}>
          {Array.from({ length: stats }, (_, i) => <div key={i} className="card h-[86px] p-4"><div className={`${BLOCK} h-3 w-20`} /><div className={`${BLOCK} h-6 w-16 mt-3`} /></div>)}
        </div>
      )}
      {sidebar ? (
        <div className="grid grid-cols-1 lg:grid-cols-[272px_minmax(0,1fr)] gap-5 items-start">
          <div className="card h-[520px] hidden lg:block" />
          {content}
        </div>
      ) : content}
    </Shell>
  );
}
