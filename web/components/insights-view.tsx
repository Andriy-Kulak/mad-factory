"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { INSIGHT_DIMS, type AdCard, type InsightDim } from "@/lib/ad-cards";
import { advertiserMatrix, browseHref, insightFiltersHref, insightTable, LOW_N, workingHooks, type InsightFilters, type InsightRow, type InsightView, type InsightWindow } from "@/lib/insights";
import { DataTable, type Column, type Row } from "@/components/data-table";
import { Chips, Toggle, useUrlState } from "@/components/controls";
import { Badge, Pair, SectionHead, Stat } from "@/components/ui";

/*
 * Competitor insights: which angles, personas, hook types, formats and landing pages the ads that keep running use,
 * all time or in the last 14 days. Every card arrives once from the server; tabs, window and relation switch here
 * and the URL follows. Pure logic: lib/insights.ts.
 */

const WINDOWS: { key: InsightWindow; label: string }[] = [
  { key: "all", label: "All time" },
  { key: "14d", label: "Last 14 days" },
];
const VIEWS: { key: InsightView; label: string }[] = [
  { key: "totals", label: "Totals" },
  { key: "advertisers", label: "By advertiser" },
];
const RULE: Record<InsightWindow, string> = {
  all: "Working = still running after 21+ days and top 10 by impressions or 5+ versions.",
  "14d": "Ads launched in the last 14 days. Too new for the 21-day rule, so working = early signal: still running and already top 10 by impressions (each advertiser's Ad Library sort).",
};

const pct = (x: number) => (x > 0 && x < 0.01 ? "<1%" : `${Math.round(x * 100)}%`);
const CountLink = ({ href, children, strong = false }: { href: string; children: React.ReactNode; strong?: boolean }) => (
  <Link href={href} className={`num underline decoration-dotted decoration-fg-3 underline-offset-4 hover:text-accent hover:decoration-accent ${strong ? "font-semibold" : ""}`}>{children}</Link>
);

export function InsightsView({ cards, slug, initial, hasAdjacent }: { cards: AdCard[]; slug: string; initial: InsightFilters; hasAdjacent: boolean }) {
  const [f, setF] = useState(initial);
  useUrlState(insightFiltersHref(f));
  const update = (patch: Partial<InsightFilters>) => setF((cur) => ({ ...cur, ...patch }));
  const table = useMemo(() => insightTable(cards, f), [cards, f]);
  const advertisers = useMemo(() => new Set(table.rows.length ? cards.filter((c) => !f.relation || c.relation === f.relation).map((c) => c.advertiserId) : []).size, [cards, f.relation, table.rows.length]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 mb-4">
        <Toggle label="Time window" items={WINDOWS} active={f.window} onChange={(window) => update({ window })} />
        {hasAdjacent && (
          <Chips items={[{ key: "competitor", label: "Direct competitors" }, { key: "inspiration", label: "Adjacent niches" }, { key: "all", label: "All advertisers" }]}
            active={f.relation ?? "all"} onChange={(k) => update({ relation: k === "all" ? null : (k as InsightFilters["relation"]) })} />
        )}
      </div>
      <p className="text-[13px] text-fg-3 mb-4 max-w-[760px]">{RULE[f.window]} Lift = share of working ads ÷ share of all ads; 2.0 means twice as common among working ads.</p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat label={f.dim === "landing" ? "Ads" : "Profiled ads"} value={table.total} hint={f.window === "14d" ? "launched in 14 days" : "ad cards"} />
        <Stat label={f.window === "all" ? "Working" : "Early signal"} value={table.working} hint={table.total ? `${pct(table.working / table.total)} of them` : undefined} tone={table.working ? "accent" : "neutral"} />
        <Stat label="Advertisers" value={advertisers} />
        <Stat label="Not profiled yet" value={table.unprofiled} hint={table.unprofiled ? "mostly short tests, never profiled" : undefined} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <Toggle label="Group by" items={(Object.keys(INSIGHT_DIMS) as InsightDim[]).map((key) => ({ key, label: INSIGHT_DIMS[key] }))} active={f.dim} onChange={(dim) => update({ dim })} />
        <Toggle size="sm" label="View" items={VIEWS} active={f.view} onChange={(view) => update({ view })} />
      </div>

      {f.view === "totals" ? <TotalsTable rows={table.rows} f={f} slug={slug} /> : <AdvertiserTable cards={cards} f={f} slug={slug} />}
      {f.dim === "hook" && <TopHooks cards={cards} f={f} slug={slug} />}
    </>
  );
}

function TotalsTable({ rows, f, slug }: { rows: InsightRow[]; f: InsightFilters; slug: string }) {
  const columns: Column[] = [
    { label: INSIGHT_DIMS[f.dim] },
    { label: "Ads", align: "right" },
    { label: f.window === "all" ? "Working" : "Early signal", align: "right" },
    { label: "Lift", align: "right", title: "Share of working ads ÷ share of all ads" },
    { label: "Advertisers", align: "right" },
    { label: "Longest running", align: "right", title: "Among this row's ads that are still running" },
    ...(f.window === "all" ? [{ label: "New in 30d", align: "right" as const }] : []),
  ];
  const data: Row[] = rows.map((r) => {
    const low = r.working > 0 && r.working < LOW_N;
    const strong = r.lift != null && r.lift >= 1.2 && !low;
    return {
      id: r.value,
      href: browseHref(slug, f, { value: r.value }),
      search: r.label,
      cells: [
        { node: <span className={`font-medium ${f.dim === "landing" ? "num text-[12.5px]" : ""}`}>{r.label}</span>, value: r.label },
        { node: <Pair top={<CountLink href={browseHref(slug, f, { value: r.value })}>{r.ads}</CountLink>} sub={`${pct(r.adShare)} of ads`} />, value: r.ads },
        { node: r.working ? <Pair top={<CountLink href={browseHref(slug, f, { value: r.value, workingOnly: true })} strong>{r.working}</CountLink>} sub={`${pct(r.workingShare)} of working`} /> : "–", value: r.working, dim: !r.working },
        {
          node: r.lift == null || !r.working ? <span className="text-fg-3">–</span> : (
            <span className="inline-flex flex-col items-end leading-tight">
              <span className="inline-flex items-center gap-1.5">{low && <Badge tone="warn">low n</Badge>}<span className={`num ${strong ? "text-accent font-semibold" : ""}`}>{r.lift.toFixed(2)}</span></span>
              {r.top && <span className="text-[11px] text-fg-3">{r.working === 1 ? r.top.name : `${r.top.working} of ${r.working}: ${r.top.name}`}</span>}
            </span>
          ),
          value: r.working ? r.lift : null,
        },
        { node: <span className="num">{r.advertisers}</span>, value: r.advertisers },
        { node: r.longest != null ? <span className="num">{r.longest}d</span> : "–", value: r.longest, dim: r.longest == null },
        ...(f.window === "all" ? [{ node: r.recent ? <span className="num">{r.recent}</span> : "–", value: r.recent, dim: !r.recent }] : []),
      ],
    };
  });
  return <DataTable dense stickyFirst columns={columns} rows={data} searchLabel={`Search ${INSIGHT_DIMS[f.dim].toLowerCase()}s`}
    defaultSort={{ col: 2, dir: "desc" }} empty="No ads in this window yet." />;
}

function AdvertiserTable({ cards, f, slug }: { cards: AdCard[]; f: InsightFilters; slug: string }) {
  const m = useMemo(() => advertiserMatrix(cards, f), [cards, f]);
  const columns: Column[] = [
    { label: INSIGHT_DIMS[f.dim] },
    { label: "Ads", align: "right" },
    ...m.columns.map((c) => ({
      align: "right" as const,
      title: `${c.name}: ${c.ads} ads, ${c.working} working${c.relation === "inspiration" ? " · adjacent niche" : ""}`,
      label: <span className="inline-flex flex-col items-end leading-tight normal-case"><span className="max-w-[140px] truncate">{c.name}</span><span className="text-[10.5px] text-fg-3">{c.relation === "inspiration" ? "adjacent · " : ""}{c.working} working</span></span>,
    })),
  ];
  const data: Row[] = m.rows.map((r) => ({
    id: r.value,
    search: r.label,
    cells: [
      { node: <span className={`font-medium ${f.dim === "landing" ? "num text-[12.5px]" : ""}`}>{r.label}</span>, value: r.label },
      { node: <span className="num">{r.ads}</span>, value: r.ads },
      ...m.columns.map((c) => {
        const cell = r.cells[c.id];
        if (!cell) return { node: "–", value: 0, dim: true };
        const share = cell.ads / c.ads;
        return {
          value: cell.ads,
          node: (
            <span className="inline-flex flex-col items-end leading-tight rounded-[3px] px-1.5 py-0.5 -my-0.5" style={{ background: `color-mix(in srgb, var(--accent) ${Math.min(28, Math.round(share * 90))}%, transparent)` }}
              title={`${pct(share)} of ${c.name}'s ads`}>
              <CountLink href={browseHref(slug, f, { value: r.value, advertiserId: c.id })}>{cell.ads}</CountLink>
              <span className={`text-[11px] ${cell.working ? "text-accent font-semibold" : "text-fg-3"}`}>{cell.working ? `${cell.working} working` : "0"}</span>
            </span>
          ),
        };
      }),
    ],
  }));
  return <DataTable dense stickyFirst columns={columns} rows={data} searchLabel={`Search ${INSIGHT_DIMS[f.dim].toLowerCase()}s`}
    defaultSort={{ col: 1, dir: "desc" }} empty="No ads in this window yet." />;
}

function TopHooks({ cards, f, slug }: { cards: AdCard[]; f: InsightFilters; slug: string }) {
  const hooks = useMemo(() => workingHooks(cards, f), [cards, f]);
  if (!hooks.length) return null;
  return (
    <>
      <SectionHead right={<span className="text-xs text-fg-3">First spoken line, else the on-screen text · best impressions rank first</span>}>
        {f.window === "all" ? "Hooks of working ads" : "Hooks with an early signal"}
      </SectionHead>
      <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(280px,1fr))] mb-6">
        {hooks.map(({ card, text }) => (
          <Link key={card.id} href={`/p/${slug}/ads/${card.id}`} className="card p-3.5 flex flex-col gap-2 transition-colors duration-150 hover:border-fg-3">
            <span className="text-[14px] leading-snug">“{text}”</span>
            <span className="mt-auto flex flex-wrap items-center gap-1.5 text-[11.5px] text-fg-3">
              <span className="font-medium text-fg-2">{card.advertiserName ?? "Unknown advertiser"}</span>
              {card.relation === "inspiration" && <Badge>adjacent</Badge>}
              {card.profile?.fields.hook_type && <Badge>{INSIGHT_DIMS.hook.toLowerCase()}: {card.profile.fields.hook_type.replace(/_/g, " ")}</Badge>}
              {card.rank && <span className="num">#{card.rank.rank} impressions</span>}
              {card.days != null && <span className="num">· {card.days}d</span>}
              {card.versions > 1 && <span className="num">· {card.versions} versions</span>}
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
