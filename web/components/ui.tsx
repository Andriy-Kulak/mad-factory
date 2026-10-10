import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

/*
 * Shared building blocks. Styles live in app/globals.css (.card, .btn, .control, .segmented, .label, .num);
 * these components pick the right classes. /ui shows every one of them.
 */

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}

/** Card with a channel-style header row. */
export function Panel({ title, right, children, className = "" }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      <div className="flex items-baseline justify-between gap-3 px-4 pt-3.5 pb-2.5">
        <h2 className="text-[14px] font-semibold">{title}</h2>
        {right && <div className="label">{right}</div>}
      </div>
      {children}
    </section>
  );
}

type Tone = "neutral" | "accent" | "warn";
const VALUE_TONE: Record<Tone, string> = { neutral: "", accent: "text-accent", warn: "text-warn" };

/** Block meter: `value` 0–1 lights that share of the segments. */
export function Meter({ value, tone = "neutral", className = "" }: { value: number; tone?: Tone; className?: string }) {
  const fill = tone === "accent" ? "var(--accent)" : tone === "warn" ? "#e09a1a" : "var(--fg)";
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={`h-1.5 ${className}`} style={{ background: "repeating-linear-gradient(90deg, var(--line-2) 0 6px, transparent 6px 8px)" }}>
      <div className="h-full transition-[width] duration-500 ease-out" style={{ width: `${pct}%`, background: `repeating-linear-gradient(90deg, ${fill} 0 6px, transparent 6px 8px)` }} />
    </div>
  );
}

export function Stat({ label, value, hint, tone = "neutral", meter }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; meter?: number }) {
  return (
    <Card className={`min-w-0 px-4 py-3.5 ${tone === "warn" ? "!bg-warn-soft !border-[#e3b567]" : ""}`}>
      <div className="label">{label}</div>
      <div className={`num text-[22px] 2xl:text-[26px] font-medium mt-1.5 leading-tight tracking-[-0.02em] ${VALUE_TONE[tone]}`}>{value}</div>
      {meter != null && <Meter value={meter} tone={tone} className="mt-3" />}
      {hint && <div className="text-fg-3 text-xs mt-1.5">{hint}</div>}
    </Card>
  );
}

export type BadgeTone = "neutral" | "green" | "red" | "warn" | "accent";
const BADGE: Record<BadgeTone, string> = {
  neutral: "text-fg-2 bg-bg-3 border-line",
  green: "text-good bg-good-soft border-transparent",
  red: "text-danger bg-danger-soft border-transparent",
  warn: "text-warn bg-warn-soft border-transparent",
  accent: "text-accent bg-accent-soft border-transparent",
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: BadgeTone }) {
  return <span className={`inline-flex items-center h-5 px-1.5 rounded-[3px] border text-[11.5px] font-medium whitespace-nowrap ${BADGE[tone]}`}>{children}</span>;
}

/** Status as a lit dot + word, for tables where a filled badge is too loud. */
export function StatusDot({ children, tone = "neutral" }: { children: ReactNode; tone?: BadgeTone }) {
  const dot = { neutral: "bg-fg-3", green: "bg-good", red: "bg-danger", warn: "bg-[#e09a1a]", accent: "bg-accent" }[tone];
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px]">
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {children}
    </span>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="label mb-1">{label}</div>
      <div className="text-[14px] leading-relaxed">{children ?? <span className="text-fg-3">–</span>}</div>
    </div>
  );
}

export function List({ items }: { items: string[] }) {
  if (!items.length) return <span className="text-fg-3">–</span>;
  return (
    <ul className="flex flex-col gap-1">
      {items.map((i, n) => (
        <li key={n} className="flex gap-2"><span className="text-fg-3">–</span><span>{i}</span></li>
      ))}
    </ul>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="card border-dashed p-10 text-center text-fg-2 text-[13px] leading-relaxed">{children}</div>;
}

export type ButtonVariant = "secondary" | "primary" | "ghost" | "danger";
const VARIANT: Record<ButtonVariant, string> = { secondary: "", primary: "btn-primary", ghost: "btn-ghost", danger: "btn-danger" };

export function buttonClass(variant: ButtonVariant = "secondary", size: "md" | "sm" = "md", className = "") {
  return `btn ${VARIANT[variant]} ${size === "sm" ? "btn-sm" : ""} ${className}`;
}

export function Button({ variant, size, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "md" | "sm" }) {
  return <button {...props} className={buttonClass(variant, size, className)} />;
}

export function ButtonLink({ href, children, primary = false, variant, size }: { href: string; children: ReactNode; primary?: boolean; variant?: ButtonVariant; size?: "md" | "sm" }) {
  return <Link href={href} className={buttonClass(variant ?? (primary ? "primary" : "secondary"), size)}>{children}</Link>;
}

/** Link-based segmented control (filters, ranges, sorts). The active item carries aria-current. */
export function Segmented<T extends string>({ items, active, size = "md", wrap = false, label }: { items: { key: T; label: ReactNode; href: string }[]; active: T | null; size?: "md" | "sm"; wrap?: boolean; label?: string }) {
  return (
    <nav aria-label={label} className={`segmented ${size === "sm" ? "segmented-sm" : ""} ${wrap ? "flex-wrap" : ""}`}>
      {items.map((it) => (
        <Link key={it.key} href={it.href} aria-current={it.key === active ? "page" : undefined}>{it.label}</Link>
      ))}
    </nav>
  );
}

/** Underlined page sub-tabs (links), for views of one screen: "Ads · By creative attribute". Pass to Shell's `tabs`. */
export function Tabs({ items, active, label = "Views" }: { items: { key: string; label: ReactNode; href: string }[]; active: string; label?: string }) {
  return (
    <nav aria-label={label} className="flex gap-5 border-b border-line overflow-x-auto">
      {items.map((it) => (
        <Link key={it.key} href={it.href} aria-current={it.key === active ? "page" : undefined}
          className={`relative h-9 inline-flex items-center whitespace-nowrap text-[13.5px] transition-colors duration-150 ${it.key === active ? "text-fg font-semibold" : "text-fg-2 hover:text-fg"}`}>
          {it.label}
          <span className={`absolute left-0 right-0 -bottom-px h-0.5 transition-colors duration-200 ${it.key === active ? "bg-fg" : "bg-transparent"}`} />
        </Link>
      ))}
    </nav>
  );
}

/** Number on top, its rate or cost underneath: one column per metric pair instead of two. Right-aligned. */
export function Pair({ top, sub, strong = false }: { top: ReactNode; sub?: ReactNode; strong?: boolean }) {
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className={strong ? "font-semibold text-fg" : ""}>{top}</span>
      {sub != null && <span className="text-[11px] text-fg-3">{sub}</span>}
    </span>
  );
}

const DOT: Record<BadgeTone, string> = { green: "bg-good", neutral: "bg-fg-3", red: "bg-danger", warn: "bg-[#e09a1a]", accent: "bg-accent" };

/**
 * The identity cell of a table row: status dot, optional thumbnail, name, and a dim line of context (`state` when
 * the row isn't running, then `sub`: parents, headline, match type). Ids go in the tooltip, not their own line.
 */
export function NameCell({ name, id, sub, thumb, tone, state }: { name: string; id?: string; sub?: ReactNode; thumb?: string | null; tone?: BadgeTone; state?: string | null }) {
  return (
    <span className="flex items-center gap-2.5 min-w-0" title={[name + (state ? ` (${state})` : ""), id].filter(Boolean).join("\n")}>
      {thumb !== undefined && (
        <span className="w-9 h-9 shrink-0 rounded-[3px] overflow-hidden bg-bg-3 border border-line-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {thumb && <img src={thumb} alt="" loading="lazy" className="w-full h-full object-cover" />}
        </span>
      )}
      <span className="min-w-0 leading-tight">
        <span className="flex items-center gap-1.5 font-semibold max-w-[380px]">
          {tone && <span aria-label={state ?? "running"} className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT[tone]}`} />}
          <span className="truncate">{name}</span>
        </span>
        {(sub || state) && (
          <span className={`block text-[11.5px] text-fg-3 truncate max-w-[380px] ${tone ? "pl-3" : ""}`}>
            {state && <span className="text-fg-2">{state}</span>}
            {state && sub ? " · " : null}
            {sub}
          </span>
        )}
      </span>
    </span>
  );
}

export function SectionHead({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-3">
      <h2 className="text-[15px] font-semibold">{children}</h2>
      {right}
    </div>
  );
}

/* Tables */

export function Th({ children, right = false }: { children?: ReactNode; right?: boolean }) {
  return <th className={`label font-normal h-10 px-3 whitespace-nowrap ${right ? "text-right" : "text-left"}`}>{children}</th>;
}

export function Td({ children, right = false, dim = false, className = "" }: { children?: ReactNode; right?: boolean; dim?: boolean; className?: string }) {
  return <td className={`px-3 py-2 whitespace-nowrap ${right ? "text-right num" : ""} ${dim ? "text-fg-3" : ""} ${className}`}>{children}</td>;
}

/** Bordered rows with a hover highlight; wrap in a Card (or use Table) for the frame. */
export const TABLE_CLASS =
  "w-full text-[13px] border-collapse [&_thead_tr]:border-b [&_thead_tr]:border-line [&_tbody_tr]:border-t [&_tbody_tr]:border-line-2 [&_tbody_tr]:transition-colors [&_tbody_tr]:duration-150 [&_tbody_tr:hover]:bg-bg-3";

export function Table({ children, className = "mb-6" }: { children: ReactNode; className?: string }) {
  return (
    <Card className={`overflow-x-auto ${className}`}>
      <table className={TABLE_CLASS}>{children}</table>
    </Card>
  );
}
