"use client";

import { useCallback, useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode, type Ref, type RefObject } from "react";

/*
 * Interactive building blocks for browse screens (grids and lists with a filter sidebar). They hold state in the
 * browser, so every change is instant; pair them with useUrlState so a filtered view stays shareable.
 * The Organic tab (components/organic-browser.tsx) and Competitor ads (components/ad-browser.tsx) are built from
 * these; /ui shows each one. Static, link-based versions live in components/ui.tsx.
 */

const X_ICON = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg>;
const CHEVRON = (open: boolean) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" className={`text-fg-3 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}><path d="M6 9l6 6 6-6" /></svg>
);

/** Keeps the address bar's query string equal to `query` ("?a=1" or "?") without a server round trip. */
export function useUrlState(query: string) {
  useEffect(() => {
    window.history.replaceState(null, "", query === "?" ? window.location.pathname : query);
  }, [query]);
}

/** Runs `fn` when `key` is pressed outside any input, e.g. "/" to focus search. */
export function useHotkey(key: string, fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key !== key || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable], dialog")) return;
      e.preventDefault();
      ref.current();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [key]);
}

/**
 * Render-as-you-scroll paging: `limit` grows by `pageSize` when the sentinel nears the viewport. Call `reset` when
 * the list's filters change. Render <LoadMore> after the list.
 */
export function useInfiniteList(total: number, pageSize: number) {
  const [limit, setLimit] = useState(pageSize);
  const sentinel = useRef<HTMLDivElement>(null);
  const more = total > limit;
  const showMore = useCallback(() => setLimit((l) => l + pageSize), [pageSize]);
  const reset = useCallback(() => setLimit(pageSize), [pageSize]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !more) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) showMore(); }, { rootMargin: "1200px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [more, limit, showMore]);
  return { limit, more, showMore, reset, sentinel, setLimit };
}

export function LoadMore({ list, total, noun = "items" }: { list: ReturnType<typeof useInfiniteList>; total: number; noun?: string }) {
  if (!list.more) return null;
  return (
    <div ref={list.sentinel} className="flex justify-center mt-6">
      <button type="button" onClick={list.showMore} className="btn">
        Show more {noun} <span className="text-fg-3 num">({Math.min(list.limit, total)} of {total})</span>
      </button>
    </div>
  );
}

/** Segmented control driven by state (sort, view). The link-based twin is Segmented in ui.tsx. */
export function Toggle<T extends string>({ label, items, active, onChange, size = "md" }: { label: string; items: { key: T; label: ReactNode }[]; active: T; onChange: (k: T) => void; size?: "md" | "sm" }) {
  return (
    <div role="group" aria-label={label} className={`segmented ${size === "sm" ? "segmented-sm" : ""}`}>
      {items.map((it) => (
        <button key={it.key} type="button" aria-pressed={it.key === active} onClick={() => onChange(it.key)}>{it.label}</button>
      ))}
    </div>
  );
}

/** Single-choice chip row for presets. Clicking the active chip again picks the first ("Any") item. */
export function Chips({ items, active, onChange }: { items: { key: string; label: ReactNode }[]; active: string; onChange: (k: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((it) => {
        const on = it.key === active;
        return (
          <button key={it.key} type="button" aria-pressed={on} onClick={() => onChange(on ? (items[0]?.key ?? "") : it.key)}
            className={`h-7 px-2.5 rounded-[3px] border text-[12.5px] font-medium transition-colors duration-150 ${on ? "bg-fg text-signal border-fg" : "bg-bg-2 border-line text-fg-2 hover:text-fg hover:border-fg-3"}`}>
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

export type ActiveFilter = { key: string; label: ReactNode; remove: () => void };

/** Row of removable chips, one per active filter, plus "Clear all". Renders nothing when no filter is on. */
export function ActiveFilters({ filters, onClear }: { filters: ActiveFilter[]; onClear: () => void }) {
  if (!filters.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 mb-4">
      {filters.map((f) => (
        <button key={f.key} type="button" onClick={f.remove} title="Remove filter"
          className="group inline-flex items-center gap-1.5 h-7 pl-2.5 pr-1.5 rounded-full border border-line bg-bg-2 text-[12.5px] font-medium transition-colors duration-150 hover:border-fg-3 hover:bg-bg-3">
          {f.label}
          <span className="text-fg-3 group-hover:text-fg">{X_ICON}</span>
        </button>
      ))}
      <button type="button" onClick={onClear} className="text-[12.5px] text-fg-2 hover:text-fg underline underline-offset-2 ml-1">Clear all</button>
    </div>
  );
}

/**
 * Text input that commits while you type (debounced), on Enter and on blur; Esc clears it. It follows `value` when
 * that changes from outside (a preset, a removed chip, Reset) unless the draft already means the same thing.
 */
export function DraftInput({ value, onCommit, parse, ref, delay = 250, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string; onCommit: (s: string) => void; parse?: (s: string) => unknown; ref?: Ref<HTMLInputElement>; delay?: number;
}) {
  const same = (a: string, b: string) => (parse ? parse(a) === parse(b) : a === b);
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (!same(draft, value)) setDraft(value);
  }
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const commit = (s: string) => {
    clearTimeout(timer.current);
    if (!same(s, value)) onCommit(s);
  };
  return (
    <input {...props} ref={ref} value={draft} autoComplete="off"
      onChange={(e) => {
        const s = e.target.value;
        setDraft(s);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => commit(s), delay);
      }}
      onBlur={() => commit(draft)}
      onKeyDown={(e) => { if (e.key === "Enter") commit(draft); if (e.key === "Escape" && draft) { e.stopPropagation(); setDraft(""); commit(""); } }} />
  );
}

/** Live search box with a clear button and a "/" shortcut that focuses it from anywhere on the page. */
export function SearchInput({ value, onChange, placeholder, label, inputRef }: { value: string; onChange: (s: string) => void; placeholder: string; label: string; inputRef?: RefObject<HTMLInputElement | null> }) {
  const own = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? own;
  useHotkey("/", () => ref.current?.focus());
  return (
    <div className="relative">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-3 pointer-events-none"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
      <DraftInput ref={ref} value={value} onCommit={(s) => onChange(s.trim())} placeholder={placeholder} aria-label={label} className="control w-full !pl-8 !pr-8" />
      {value ? (
        <button type="button" onClick={() => onChange("")} aria-label="Clear search" className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 grid place-items-center rounded-[3px] text-fg-3 hover:text-fg hover:bg-bg-3">{X_ICON}</button>
      ) : (
        <kbd className="absolute right-2 top-1/2 -translate-y-1/2 num text-[11px] text-fg-3 border border-line rounded-[3px] px-1.5 leading-[18px] pointer-events-none">/</kbd>
      )}
    </div>
  );
}

type Range = { min: number | null; max: number | null };

/** Preset chips ("Any", "3×+", …) over min/max inputs that accept 10k, 1.5m, 3x, 2%. */
export function RangeFilter({ label, value, onChange, presets, fmt, parse, placeholder = ["min", "max"] }: {
  label: string; value: Range; onChange: (r: Range) => void; presets: number[]; fmt: (v: number) => string;
  parse: (s: string) => number | null; placeholder?: [string, string];
}) {
  const preset = value.min == null && value.max == null ? "" : value.max == null && value.min != null && presets.includes(value.min) ? String(value.min) : "custom";
  return (
    <>
      <Chips items={[{ key: "", label: "Any" }, ...presets.map((p) => ({ key: String(p), label: `${fmt(p)}+` }))]} active={preset}
        onChange={(k) => onChange({ min: k ? Number(k) : null, max: null })} />
      <div className="flex items-center gap-2 mt-2">
        <DraftInput value={value.min == null ? "" : String(value.min)} parse={parse} placeholder={placeholder[0]} inputMode="decimal" aria-label={`${label} min`} className="control w-full min-w-0"
          onCommit={(s) => onChange({ ...value, min: parse(s) })} />
        <span className="text-fg-3">–</span>
        <DraftInput value={value.max == null ? "" : String(value.max)} parse={parse} placeholder={placeholder[1]} inputMode="decimal" aria-label={`${label} max`} className="control w-full min-w-0"
          onCommit={(s) => onChange({ ...value, max: parse(s) })} />
      </div>
    </>
  );
}

export type Option = { value: string; label: string; detail?: ReactNode; icon?: ReactNode; keywords?: string };

/**
 * Multi-select in a popover: search, select all/clear, applies on every click. Closes on Esc, a click outside or
 * Done, and gives focus back to its button. An empty selection means "all".
 */
export function MultiSelect({ options, selected, onChange, allLabel, noun, summaryIcon }: {
  options: Option[]; selected: string[]; onChange: (values: string[]) => void; allLabel: string; noun: string; summaryIcon?: (o: Option) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback((focus = true) => {
    setOpen(false);
    setQ("");
    if (focus) trigger.current?.focus();
  }, []);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) close(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [open, close]);

  const chosen = options.filter((o) => selected.includes(o.value));
  const summary = chosen.length === 0 ? allLabel : chosen.length === 1 ? chosen[0]!.label : `${chosen.length} ${noun}`;
  const needle = q.trim().toLowerCase().replace(/^@/, "");
  const list = needle ? options.filter((o) => `${o.label} ${o.keywords ?? ""}`.toLowerCase().includes(needle)) : options;
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v]);

  return (
    <div ref={root} className="relative">
      <button ref={trigger} type="button" onClick={() => (open ? close() : setOpen(true))} aria-haspopup="listbox" aria-expanded={open}
        className={`control w-full flex items-center gap-2 text-left cursor-pointer ${open ? "!border-fg" : ""}`}>
        {chosen.length === 1 && summaryIcon?.(chosen[0]!)}
        <span className={`truncate flex-1 ${chosen.length ? "font-medium pr-6" : ""}`}>{summary}</span>
        {CHEVRON(open)}
      </button>
      {chosen.length > 0 && (
        <button type="button" aria-label={`Show ${allLabel.toLowerCase()}`} title={allLabel} onClick={() => onChange([])}
          className="absolute right-7 top-1/2 -translate-y-1/2 w-5 h-5 grid place-items-center rounded-[3px] text-fg-3 hover:text-fg hover:bg-bg-3">{X_ICON}</button>
      )}
      {open && (
        <div className="enter absolute z-40 left-0 mt-1 w-full lg:w-[340px] card shadow-[0_16px_40px_rgb(0_0_0/0.18)] flex flex-col max-h-[min(480px,70dvh)]">
          <div className="p-2 border-b border-line-2">
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${options.length} ${noun}`} aria-label={`Search ${noun}`} className="control w-full"
              onKeyDown={(e) => { if (e.key === "Enter" && list.length === 1) toggle(list[0]!.value); }} />
          </div>
          <div className="flex items-center gap-3 px-3 py-1.5 text-[12px] text-fg-2 border-b border-line-2">
            <span>{selected.length ? `${selected.length} selected` : "Showing all"}</span>
            <button type="button" onClick={() => onChange([...new Set([...selected, ...list.map((o) => o.value)])])} className="ml-auto hover:text-fg underline-offset-2 hover:underline">Select {needle ? "matches" : "all"}</button>
            <button type="button" onClick={() => onChange([])} disabled={!selected.length} className="hover:text-fg underline-offset-2 hover:underline disabled:opacity-40">Clear</button>
          </div>
          <div role="listbox" aria-multiselectable="true" aria-label={noun} className="overflow-y-auto py-1 flex-1 min-h-0">
            {list.length === 0 && <div className="px-3 py-6 text-center text-fg-3 text-[13px]">Nothing matches “{q}”.</div>}
            {list.map((o) => {
              const on = selected.includes(o.value);
              return (
                <button key={o.value} type="button" role="option" aria-selected={on} onClick={() => toggle(o.value)}
                  className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[13px] transition-colors duration-100 ${on ? "bg-accent-soft" : "hover:bg-bg-3"}`}>
                  <span className={`w-4 h-4 shrink-0 rounded-[3px] border grid place-items-center transition-colors duration-100 ${on ? "bg-fg border-fg text-signal" : "border-[#b9bcae] bg-bg-2"}`}>
                    {on && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>}
                  </span>
                  {o.icon}
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium truncate">{o.label}</span>
                    {o.detail && <span className="block text-fg-3 text-[11.5px] truncate">{o.detail}</span>}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="p-2 border-t border-line-2 flex justify-end">
            <button type="button" onClick={() => close()} className="btn btn-sm">Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Filter sidebar: sticky on wide screens, behind a "Filters · n" toggle on narrow ones. Put the results next to it
 * inside <BrowseLayout>.
 */
export function BrowseLayout({ filters, count, onReset, children }: { filters: ReactNode; count: number; onReset: () => void; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[272px_minmax(0,1fr)] gap-5 items-start">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="btn lg:hidden justify-between">
        <span>Filters{count > 0 && <span className="num ml-1.5 text-accent">· {count}</span>}</span>
        {CHEVRON(open)}
      </button>
      <aside aria-label="Filters" className={`card p-4 flex-col gap-5 relative z-20 lg:sticky lg:top-4 ${open ? "flex" : "hidden lg:flex"}`}>
        <div className="flex items-center justify-between -mb-1">
          <span className="text-[12px] font-semibold tracking-[0.08em] uppercase text-fg-2">Filters</span>
          <button type="button" onClick={onReset} disabled={count === 0} className="text-[13px] text-fg-2 hover:text-fg disabled:opacity-40 disabled:pointer-events-none">Reset</button>
        </div>
        {filters}
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function FilterSection({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <div className="label mb-1.5">{label}{hint && <span className="font-normal text-fg-3"> · {hint}</span>}</div>
      {children}
    </div>
  );
}

/** Results header: count on the left, controls (Toggle sort/view) on the right. */
export function ResultsBar({ shown, total, noun, children }: { shown: number; total: number; noun: [string, string]; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3">
      <div className="text-[13px] text-fg-2 mr-auto">
        <span className="num font-medium text-fg">{shown.toLocaleString("en-US")}</span> {shown === 1 ? noun[0] : noun[1]}
        {shown !== total && <> of <span className="num">{total.toLocaleString("en-US")}</span></>}
      </div>
      {children}
    </div>
  );
}

/** Dashed empty state with an optional "Clear filters" action. */
export function NoMatches({ onClear, children = "Nothing matches these filters." }: { onClear?: () => void; children?: ReactNode }) {
  return (
    <div className="card border-dashed p-10 text-center text-fg-2 text-[13px]">
      {children}
      {onClear && <div className="mt-3"><button type="button" onClick={onClear} className="btn btn-sm">Clear filters</button></div>}
    </div>
  );
}

const ARROW = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

/**
 * Modal on the native <dialog>: Esc, the close button or a backdrop click closes it; with onPrev/onNext the arrow
 * keys step through a list. Open it by passing open={true}; onClose fires however it closes.
 */
export function Modal({ open, onClose, onPrev, onNext, position, label, header, children }: {
  open: boolean; onClose: () => void; onPrev?: (() => void) | null; onNext?: (() => void) | null; position?: string; label: string; header?: ReactNode; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft" && onPrev) { e.preventDefault(); onPrev(); }
      if (e.key === "ArrowRight" && onNext) { e.preventDefault(); onNext(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, onPrev, onNext]);
  const nav = onPrev !== undefined || onNext !== undefined;
  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => { if (e.target === e.currentTarget) ref.current?.close(); }} aria-label={label}
      className="enter m-auto p-0 bg-transparent max-w-none max-h-none backdrop:bg-black/70 backdrop:backdrop-blur-[2px]">
      {open && (
        <div className="relative w-[min(980px,calc(100vw-24px))] max-h-[calc(100dvh-24px)] flex flex-col bg-bg-2 rounded-[6px] overflow-hidden shadow-[0_24px_64px_rgb(0_0_0/0.35)]">
          <div className="flex items-center gap-3 px-4 h-12 border-b border-line-2 shrink-0">
            <div className="min-w-0 flex-1">{header}</div>
            {position && <span className="num text-[12px] text-fg-3 shrink-0">{position}</span>}
            <div className="flex items-center gap-1 shrink-0">
              {nav && <button type="button" onClick={onPrev ?? undefined} disabled={!onPrev} aria-label="Previous (←)" title="Previous (←)" className="btn btn-ghost btn-sm !px-2"><svg {...ARROW}><path d="M15 6l-6 6 6 6" /></svg></button>}
              {nav && <button type="button" onClick={onNext ?? undefined} disabled={!onNext} aria-label="Next (→)" title="Next (→)" className="btn btn-ghost btn-sm !px-2"><svg {...ARROW}><path d="M9 6l6 6-6 6" /></svg></button>}
              <button type="button" onClick={() => ref.current?.close()} aria-label="Close (Esc)" title="Close (Esc)" className="btn btn-ghost btn-sm !px-2"><svg {...ARROW}><path d="M6 6l12 12M18 6L6 18" /></svg></button>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto md:overflow-hidden">{children}</div>
        </div>
      )}
    </dialog>
  );
}

/** Plain click runs `open` (e.g. a preview); cmd/ctrl/shift/middle click keeps the link's normal behaviour. */
export function previewClick(e: React.MouseEvent, open: () => void) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  e.preventDefault();
  open();
}
