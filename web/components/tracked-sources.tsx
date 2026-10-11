import type { ReactNode } from "react";
import { removeSource, setAdSourceRelation, setSourceEnabled } from "@/lib/source-actions";
import { trackedSourceUrl, type TrackedSourceItem } from "@/lib/tracked-sources";
import { fmtDate } from "@/lib/format";
import { Badge } from "@/components/ui";
import { platformLabel } from "@/components/social";
import { ActionSwitch } from "@/components/switch";

const sourceName = (s: TrackedSourceItem) => (s.source === "meta" ? (s.kind === "page" ? `Page ${s.value}` : `“${s.value}”`) : s.source === "facebook" ? facebookName(s.value) : `@${s.value}`);

const facebookName = (url: string) => {
  const u = new URL(url);
  return u.searchParams.get("id") ? `Page ${u.searchParams.get("id")}` : u.pathname.replace(/^\/|\/$/g, "");
};

/** Collapsible "manage what this tab tracks" card: add form on top, tracked rows with pause/resume/remove. */
export function TrackedSourcesPanel({
  productId,
  slug,
  title,
  items,
  form,
  showRelation = false,
  open = false,
}: {
  productId: string;
  slug: string;
  title: string;
  items: TrackedSourceItem[];
  form: ReactNode;
  showRelation?: boolean;
  open?: boolean;
}) {
  const paused = items.filter((s) => !s.enabled).length;
  return (
    <details className="card mb-5 group" open={open}>
      <summary className="px-4 h-12 flex items-center gap-3 cursor-pointer select-none list-none rounded-[3px] transition-colors duration-150 hover:bg-bg-3 [&::-webkit-details-marker]:hidden">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden="true"
          className="text-fg-3 transition-transform duration-[280ms] ease-drawer group-open:rotate-90"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
        <span className="text-[14px] font-semibold">{title}</span>
        <span className="text-fg-3 text-xs">
          {items.length} tracked{paused ? ` · ${paused} paused` : ""}
        </span>
        <span className="ml-auto btn btn-sm pointer-events-none group-open:hidden">Add or manage</span>
        <span className="ml-auto btn btn-sm btn-ghost pointer-events-none hidden group-open:inline-flex">Done</span>
      </summary>
      <div className="px-4 pb-4 border-t border-line pt-4">
        {form}
        {items.length > 0 && (
          <div className="mt-4 divide-y divide-line-2 border border-line rounded-[3px]">
            {items.map((s) => {
              const url = trackedSourceUrl(s);
              return (
                <div key={s.id} className={`flex items-center gap-3 px-3 py-1 text-[13px] transition-opacity duration-200 ${s.enabled ? "" : "opacity-60"}`}>
                  <Badge>{s.source === "meta" ? (s.kind === "page" ? "Page" : "Keyword") : platformLabel(s.source)}</Badge>
                  {url ? (
                    <a href={url} target="_blank" rel="noreferrer" className="font-medium truncate hover:underline">
                      {sourceName(s)}
                    </a>
                  ) : (
                    <span className="font-medium truncate">{sourceName(s)}</span>
                  )}
                  {s.label && <span className="text-fg-2 truncate">{s.label}</span>}
                  {showRelation && s.relation && <Badge tone={s.relation === "competitor" ? "red" : "neutral"}>{s.relation}</Badge>}
                  {s.source === "meta" && <span className="text-fg-3 text-xs">{s.country}</span>}
                  {s.source === "meta" && (
                    <form action={setAdSourceRelation.bind(null, productId, slug, s.id, s.relation === "inspiration" ? "competitor" : "inspiration")}>
                      <button className="btn btn-sm btn-ghost" title={`Switch to ${s.relation === "inspiration" ? "direct competitor" : "adjacent niche (inspiration)"}`}>
                        {s.relation === "inspiration" ? "Adjacent niche" : "Direct competitor"}{" "}
                        <span aria-hidden="true" className="text-fg-3">
                          ⇄
                        </span>
                      </button>
                    </form>
                  )}
                  <span className="ml-auto text-fg-3 text-xs whitespace-nowrap">
                    {!s.enabled ? "Paused" : s.synced ? (s.lastScrapedAt ? `Synced ${fmtDate(s.lastScrapedAt)}` : "Synced") : "Waiting for first sync"}
                  </span>
                  <ActionSwitch checked={s.enabled} action={setSourceEnabled.bind(null, productId, slug, s.id, !s.enabled)} label={`${s.enabled ? "Pause" : "Resume"} tracking ${sourceName(s)}`} />
                  <form action={removeSource.bind(null, productId, slug, s.id)}>
                    <button className="btn btn-sm btn-danger" title="Stops tracking. Stored posts, ads and history are kept.">
                      Remove
                    </button>
                  </form>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </details>
  );
}

const PLATFORM_OPTIONS = [
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "facebook", label: "Facebook" },
];

/** Inputs for adding a social account; `relations` with one entry renders as a hidden field. */
export function SocialAccountFields({ relations, labels }: { relations: { value: string; label: string }[]; labels: string[] }) {
  return (
    <>
      <select name="platform" className="control" defaultValue="instagram" aria-label="Platform">
        {PLATFORM_OPTIONS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
      <input name="value" required placeholder="Handle or profile link" className="control flex-1 min-w-[240px]" autoComplete="off" />
      <input name="label" list="source-labels" placeholder="Person or brand (optional)" className="control w-[220px]" autoComplete="off" />
      <datalist id="source-labels">
        {labels.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>
      {relations.length === 1 ? (
        <input type="hidden" name="relation" value={relations[0].value} />
      ) : (
        <select name="relation" className="control" defaultValue={relations[0]?.value} aria-label="Account type">
          {relations.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      )}
    </>
  );
}

export function AdLibraryFields() {
  return (
    <>
      <input name="value" required placeholder="Meta Ad Library link or page ID" className="control flex-1 min-w-[320px]" autoComplete="off" />
      <input name="label" placeholder="Name (optional)" className="control w-[220px]" autoComplete="off" />
      <select name="relation" className="control" defaultValue="competitor" aria-label="Advertiser type">
        <option value="competitor">Direct competitor</option>
        <option value="inspiration">Adjacent niche (inspiration)</option>
      </select>
    </>
  );
}
