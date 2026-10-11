"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import { TABLE_CLASS } from "./ui";
import { SearchInput, Toggle } from "./controls";

export interface Column {
  label: ReactNode;
  align?: "left" | "right";
  /** Default true. */
  sortable?: boolean;
  /** Direction of the first click; numbers default to high-first. */
  firstDir?: "asc" | "desc";
  title?: string;
}

export interface Cell {
  node: ReactNode;
  /** What the column sorts by; falls back to the node when it is a string or number. Null sorts last. */
  value?: string | number | null;
  dim?: boolean;
  className?: string;
}

export interface Row {
  id: string;
  cells: Cell[];
  className?: string;
  /** Makes the whole row a link (Enter works too); http(s) URLs open in a new tab. Links inside cells still win. */
  href?: string;
  /** Client callers only: runs on row click instead of navigating (e.g. pick a filter). */
  onClick?: () => void;
  /** Keys of the `views` this row belongs to (e.g. ["active"]); every row is in the first view. */
  tags?: string[];
  /** Text the toolbar search matches (lowercased by the table). */
  search?: string;
}

type Sort = { col: number; dir: "asc" | "desc" } | null;

const sortValue = (c: Cell | undefined) => {
  if (!c) return null;
  if (c.value !== undefined) return c.value;
  return typeof c.node === "string" || typeof c.node === "number" ? c.node : null;
};

function SortIcon({ dir }: { dir: "asc" | "desc" | null }) {
  return (
    <svg width="9" height="12" viewBox="0 0 9 12" aria-hidden="true" className="shrink-0">
      <path d="M4.5 1 8 5H1z" fill="currentColor" className={`transition-opacity duration-150 ${dir === "asc" ? "opacity-100" : "opacity-25"}`} />
      <path d="M4.5 11 1 7h7z" fill="currentColor" className={`transition-opacity duration-150 ${dir === "desc" ? "opacity-100" : "opacity-25"}`} />
    </svg>
  );
}

/**
 * Table with click-to-sort headers. Cells are rendered by the caller (server components can pass JSX);
 * each carries a sort value. Rows glide to their new place when the browser supports view transitions.
 * `maxHeight` makes the body scroll inside the card with a sticky header. `dense` tightens rows for wide metric
 * tables; `stickyFirst` pins the name column while the numbers scroll sideways. `views` (a Toggle over row tags)
 * and `searchLabel` (a live search over row.search) add a toolbar above the table.
 */
export function DataTable({
  columns,
  rows,
  defaultSort = null,
  maxHeight,
  className = "mb-6",
  empty = "Nothing to show.",
  dense = false,
  stickyFirst = false,
  views,
  searchLabel,
}: {
  columns: Column[];
  rows: Row[];
  defaultSort?: Sort;
  maxHeight?: string;
  className?: string;
  empty?: ReactNode;
  dense?: boolean;
  stickyFirst?: boolean;
  views?: { key: string; label: string }[];
  searchLabel?: string;
}) {
  const [sort, setSort] = useState<Sort>(defaultSort);
  const [view, setView] = useState(views?.[0]?.key ?? "");
  const [q, setQ] = useState("");
  const counts = useMemo(() => new Map(views?.map((v, i) => [v.key, i === 0 ? rows.length : rows.filter((r) => r.tags?.includes(v.key)).length])), [views, rows]);
  const visible = useMemo(() => {
    const needle = q.toLowerCase();
    return rows.filter((r) => (!views || view === views[0]?.key || r.tags?.includes(view)) && (!needle || (r.search ?? "").toLowerCase().includes(needle)));
  }, [rows, views, view, q]);
  const router = useRouter();
  const open = (r: Row) => (r.onClick ? r.onClick() : /^https?:/.test(r.href!) ? window.open(r.href, "_blank", "noopener") : router.push(r.href!));
  const prefix = `dt${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  const sorted = useMemo(() => {
    if (!sort) return visible;
    const sign = sort.dir === "asc" ? 1 : -1;
    return [...visible].sort((a, b) => {
      const x = sortValue(a.cells[sort.col]);
      const y = sortValue(b.cells[sort.col]);
      if (x == null || x === "") return y == null || y === "" ? 0 : 1;
      if (y == null || y === "") return -1;
      if (typeof x === "number" && typeof y === "number") return sign * (x - y);
      return sign * String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" });
    });
  }, [visible, sort]);

  const order = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows]);

  const onSort = (col: number) => {
    const c = columns[col]!;
    const first = c.firstDir ?? (c.align === "right" ? "desc" : "asc");
    // Computed from the latest state: a quick second click can land before the first transition commits.
    const update = () => setSort((s): Sort => (s?.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: first }));
    const animate = rows.length <= 80 && "startViewTransition" in document && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!animate) return update();
    // A newer click skips the running transition; that rejection is expected.
    document.startViewTransition(() => flushSync(update)).ready.catch(() => {});
  };

  const pad = dense ? "px-2.5 py-1.5" : "px-3 py-2";
  const pin = (i: number) => (stickyFirst && i === 0 ? "sticky left-0 z-[5] bg-inherit shadow-[inset_-1px_0_0_var(--line-2)]" : "");
  const table = (
    <div className={`card overflow-auto ${views || searchLabel ? "rounded-t-none border-t-0" : className}`} style={maxHeight ? { maxHeight } : undefined}>
      <table className={`${TABLE_CLASS} [&_tbody_tr]:bg-bg-2`}>
        <thead>
          <tr>
            {columns.map((c, i) => {
              const dir = sort?.col === i ? sort.dir : null;
              const right = c.align === "right";
              return (
                <th
                  key={i}
                  aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}
                  title={c.title}
                  className={`label font-normal ${dense ? "h-9 px-2.5" : "h-10 px-3"} whitespace-nowrap sticky top-0 ${stickyFirst && i === 0 ? "left-0 z-20" : "z-10"} bg-bg-2 shadow-[inset_0_-1px_0_var(--line)] ${right ? "text-right" : "text-left"}`}
                >
                  {c.sortable === false ? (
                    c.label
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSort(i)}
                      className={`inline-flex items-center gap-1.5 h-7 -mx-1.5 px-1.5 rounded-[2px] transition-colors duration-150 hover:bg-bg-3 hover:text-fg ${dir ? "text-fg" : ""} ${right ? "flex-row-reverse" : ""}`}
                    >
                      {c.label}
                      <SortIcon dir={dir} />
                    </button>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-8 text-center text-fg-3">
                {empty}
              </td>
            </tr>
          )}
          {sorted.map((r) => (
            <tr
              key={r.id}
              className={`${r.className ?? ""} ${r.href || r.onClick ? "cursor-pointer transition-colors duration-150 hover:bg-bg-3 focus-visible:bg-bg-3 outline-none" : ""}`}
              style={{ viewTransitionName: `${prefix}-${order.get(r.id)}` }}
              tabIndex={r.href || r.onClick ? 0 : undefined}
              onClick={
                r.href || r.onClick
                  ? (e) => {
                      if (!(e.target as HTMLElement).closest("a,button,input,select")) open(r);
                    }
                  : undefined
              }
              onKeyDown={
                r.href || r.onClick
                  ? (e) => {
                      if (e.key === "Enter" && e.target === e.currentTarget) open(r);
                    }
                  : undefined
              }
            >
              {r.cells.map((c, i) => (
                <td key={i} className={`${pad} whitespace-nowrap ${columns[i]?.align === "right" ? "text-right num" : ""} ${c.dim ? "text-fg-3" : ""} ${pin(i)} ${c.className ?? ""}`}>
                  {c.node}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  if (!views && !searchLabel) return table;
  return (
    <div className={className}>
      <div className="card rounded-b-none flex flex-wrap items-center gap-2 px-2.5 py-2">
        {views && (
          <Toggle
            size="sm"
            label="Show"
            active={view}
            onChange={setView}
            items={views.map((v) => ({
              key: v.key,
              label: (
                <>
                  {v.label} <span className="num text-[11px] opacity-60 ml-1">{counts.get(v.key)}</span>
                </>
              ),
            }))}
          />
        )}
        {searchLabel && (
          <div className="ml-auto w-full sm:w-64">
            <SearchInput value={q} onChange={setQ} placeholder={searchLabel} label={searchLabel} />
          </div>
        )}
      </div>
      {table}
    </div>
  );
}
