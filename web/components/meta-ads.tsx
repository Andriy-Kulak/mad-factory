import Link from "next/link";
import type { ReactNode } from "react";
import { NameCell, Pair, Tabs, type BadgeTone } from "./ui";
import type { MetaTotals } from "@/lib/meta-ads-rollup";
import type { Cell, Column } from "./data-table";

export const META_RANGES = [7, 14, 28, 90];

/** Meta ads sub-tabs; the date range carries over between them. */
export function MetaTabs({ slug, active, range }: { slug: string; active: "ads" | "attributes"; range: MetaRange }) {
  const qs = range.custom ? `?from=${range.since}&to=${range.until}` : range.days !== 28 ? `?days=${range.days}` : "";
  return (
    <Tabs
      active={active}
      items={[
        { key: "ads", label: "Campaigns & ads", href: `/p/${slug}/meta-ads${qs}` },
        { key: "attributes", label: "By creative attribute", href: `/p/${slug}/meta-ads/creatives${qs}` },
      ]}
    />
  );
}
const isoDay = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null);
export const shortDay = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export interface MetaRange {
  since: string;
  until: string;
  days: number;
  custom: boolean;
  label: string;
}

/** `?days=` or `?from=&to=`, default the last 28 days. Dates are UTC; Meta rows are in the ad account's time zone. */
export function parseRange(sp: { days?: string; from?: string; to?: string }): MetaRange {
  const today = new Date().toISOString().slice(0, 10);
  const from = isoDay(sp.from);
  const to = isoDay(sp.to) ?? today;
  const custom = from != null && from <= to;
  const requested = Number(sp.days);
  const days = META_RANGES.includes(requested) ? requested : 28;
  const since = custom ? from : new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const until = custom ? to : today;
  return { since, until, days, custom, label: custom ? `${shortDay(since)} – ${shortDay(until)}` : `last ${days} days` };
}

export function RangePicker({ href, range, extra = {} }: { href: string; range: MetaRange; extra?: Record<string, string> }) {
  const today = new Date().toISOString().slice(0, 10);
  const qs = (p: Record<string, string>) => `?${new URLSearchParams({ ...extra, ...p })}`;
  return (
    <div className="flex flex-wrap items-center gap-2 shrink-0">
      <nav aria-label="Range" className="segmented">
        {META_RANGES.map((d) => (
          <Link key={d} href={`${href}${qs({ days: String(d) })}`} aria-current={!range.custom && d === range.days ? "page" : undefined}>
            {d}D
          </Link>
        ))}
      </nav>
      <DateRangeForm action={href} since={range.since} until={range.until} max={today} custom={range.custom} extra={extra} />
    </div>
  );
}

/** Custom from–to range; highlighted when it is the range in use. */
export function DateRangeForm({ action, since, until, max, custom, extra = {} }: { action: string; since: string; until: string; max: string; custom: boolean; extra?: Record<string, string> }) {
  return (
    <form action={action} className={`segmented ${custom ? "!border-fg" : ""}`}>
      {Object.entries(extra).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input type="date" name="from" aria-label="From" defaultValue={since} max={max} required className="num bg-transparent text-[11px] outline-none" />
      <span className="!px-0 text-fg-3">–</span>
      <input type="date" name="to" aria-label="To" defaultValue={until} max={max} className="num bg-transparent text-[11px] outline-none" />
      <button type="submit" aria-pressed={custom}>
        Apply
      </button>
    </form>
  );
}

export const int = (n: number) => n.toLocaleString("en-US");
export const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "–");
export function moneyFmt(currency: string | null) {
  const f = new Intl.NumberFormat("en-US", { style: "currency", currency: currency ?? "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (n: number) => f.format(n);
  return { money, per: (spend: number, n: number) => (n ? money(spend / n) : "–") };
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/**
 * Metric columns for Meta tables, paired so a row stays one screen wide: Spend · Impr (CTR) · Clicks · Installs
 * ($/install) · Trials · $/trial (the decision metric, bold) · Purchases ($/purchase). Pass every row's totals so
 * a metric that is zero on every row (purchases, today) is left out instead of a column of dashes.
 */
export function metaMetrics(all: MetaTotals[], currency: string | null): { columns: Column[]; cells: (t: MetaTotals) => Cell[]; hidden: string[] } {
  const { money, per } = moneyFmt(currency);
  const whole = (n: number) => (Math.abs(n) >= 1000 ? money(n).replace(/\.\d\d$/, "") : money(n));
  const any = (k: keyof MetaTotals) => all.some((t) => t[k] > 0);
  const cost = (t: MetaTotals, n: number) => (n ? t.spend / n : null);
  const defs: { col: Column; cell: (t: MetaTotals) => Cell; show: boolean; name: string }[] = [
    { name: "spend", show: true, col: { label: "Spend", align: "right" }, cell: (t) => ({ node: whole(t.spend), value: t.spend, dim: !t.spend }) },
    {
      name: "impressions",
      show: true,
      col: { label: "Impr · CTR", align: "right", title: "Impressions, click-through rate underneath" },
      cell: (t) => ({ node: <Pair top={compact.format(t.impressions)} sub={pct(t.clicks, t.impressions)} />, value: t.impressions, dim: !t.impressions }),
    },
    { name: "clicks", show: true, col: { label: "Clicks", align: "right" }, cell: (t) => ({ node: int(t.clicks), value: t.clicks, dim: !t.clicks }) },
    {
      name: "installs",
      show: any("installs"),
      col: { label: "Installs", align: "right", title: "Installs, cost per install underneath" },
      cell: (t) => ({ node: <Pair top={int(t.installs)} sub={t.installs ? per(t.spend, t.installs) : null} />, value: t.installs, dim: !t.installs }),
    },
    { name: "trials", show: any("trials"), col: { label: "Trials", align: "right" }, cell: (t) => ({ node: int(t.trials), value: t.trials, dim: !t.trials }) },
    {
      name: "cost per trial",
      show: any("trials"),
      col: { label: "$ / trial", align: "right", firstDir: "asc", title: "Cost per trial: the current decision metric" },
      cell: (t) => ({ node: t.trials ? <span className="font-semibold">{per(t.spend, t.trials)}</span> : "–", value: cost(t, t.trials), dim: !t.trials }),
    },
    {
      name: "purchases",
      show: any("purchases"),
      col: { label: "Purchases", align: "right", title: "Purchases, cost per purchase underneath" },
      cell: (t) => ({ node: <Pair top={int(t.purchases)} sub={t.purchases ? per(t.spend, t.purchases) : null} />, value: t.purchases, dim: !t.purchases }),
    },
  ];
  const shown = defs.filter((d) => d.show);
  return { columns: shown.map((d) => d.col), cells: (t) => shown.map((d) => d.cell(t)), hidden: defs.filter((d) => !d.show).map((d) => d.name) };
}

const STATUS_TONE: Record<string, BadgeTone> = { ACTIVE: "green", PAUSED: "neutral", CAMPAIGN_PAUSED: "neutral", ADSET_PAUSED: "neutral", ARCHIVED: "neutral", DELETED: "neutral" };

/** NameCell for a Meta campaign, ad set or ad: its delivery status becomes the dot. */
export function MetaName({ status, note, ...rest }: Omit<Parameters<typeof NameCell>[0], "tone" | "state"> & { status: string; note?: string | null }) {
  const state = [status === "ACTIVE" ? null : status.toLowerCase().replace(/_/g, " "), note].filter(Boolean).join(" · ");
  return <NameCell {...rest} tone={STATUS_TONE[status] ?? "red"} state={state || null} />;
}

/** Sort value that keeps running objects first. */
export const statusRank = (status: string) => (status === "ACTIVE" ? 0 : /PAUSED/.test(status) ? 1 : 2);
