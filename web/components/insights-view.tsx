"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { INSIGHT_DIMS, type AdCard, type InsightDim } from "@/lib/ad-cards";
import {
  advertiserMatrix,
  browseHref,
  drillCards,
  insightFiltersHref,
  insightTable,
  workingHooks,
  type DrillMode,
  type InsightFilters,
  type InsightRow,
  type InsightView,
  type InsightWindow,
} from "@/lib/insights";
import { DataTable, type Column, type Row } from "@/components/data-table";
import { AdGrid, AdPreview, type Favorites } from "@/components/ad-card";
import { setFavorite } from "@/lib/favorite-actions";
import { useInvalidateProduct } from "@/lib/use-tab";
import { Chips, Toggle, useFavoriteSet, useUrlState } from "@/components/controls";
import { Badge, Pair, SectionHead, Stat } from "@/components/ui";

/*
 * Competitor insights: which angles, personas, hook types, formats and landing pages the ads that keep running use,
 * all time or in the last 14 days. Every card arrives once from the server; tabs, window and relation switch here
 * and the URL follows. Clicking a row or an advertiser cell opens its ads below the table. Pure logic: lib/insights.ts.
 */

const WINDOWS: { key: InsightWindow; label: string }[] = [
  { key: "all", label: "All time" },
  { key: "14d", label: "Last 14 days" },
];
const VIEWS: { key: InsightView; label: string }[] = [
  { key: "advertisers", label: "By advertiser" },
  { key: "totals", label: "Totals" },
];
const RULE: Record<InsightWindow, string> = {
  all: "Working = still running after 21+ days and top 10 by impressions or 5+ versions.",
  "14d": "Ads launched in the last 14 days. Too new for the 21-day rule, so working = early signal: still running and already top 10 by impressions (each advertiser's Ad Library sort).",
};
const WORKING: Record<InsightWindow, string> = { all: "Working", "14d": "Early signal" };
const ALIVE: Record<InsightWindow, string> = { all: "Running 21d+", "14d": "Still running" };
const DRILL_PAGE = 12;

const pct = (x: number) => (x > 0 && x < 0.01 ? "<1%" : `${Math.round(x * 100)}%`);

export function InsightsView({
  cards,
  slug,
  productId,
  favoriteIds,
  initial,
  hasAdjacent,
}: {
  cards: AdCard[];
  slug: string;
  productId: string;
  favoriteIds: string[];
  initial: InsightFilters;
  hasAdjacent: boolean;
}) {
  const invalidateProduct = useInvalidateProduct();
  const [f, setF] = useState(initial);
  // Same favorites as Competitor ads: a card is starred when any ad in its group is.
  const [favs, setFavs] = useFavoriteSet(favoriteIds, async (ids, on) => {
    await setFavorite(productId, "ad", ids, on);
    await invalidateProduct(productId);
  });
  const isFav = (a: AdCard) => a.memberIds.some((id) => favs.has(id));
  const fav: Favorites<AdCard> = { has: isFav, toggle: (a) => (isFav(a) ? setFavs(a.memberIds, false) : setFavs([a.id], true)) };
  useUrlState(insightFiltersHref(f));
  const update = (patch: Partial<InsightFilters>) => setF((cur) => ({ ...cur, ...patch }));
  /** A new grouping, window or scope closes the drill-down; its row may not exist there. */
  const rescope = (patch: Partial<InsightFilters>) => update({ ...patch, value: null, advertiserId: null });
  const select = (value: string, advertiserId: string | null = null) => update(f.value === value && f.advertiserId === advertiserId ? { value: null, advertiserId: null } : { value, advertiserId });
  const table = useMemo(() => insightTable(cards, f), [cards, f]);
  const advertisers = useMemo(() => new Set(cards.filter((c) => !f.relation || c.relation === f.relation).map((c) => c.advertiserId)).size, [cards, f.relation]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 mb-4">
        <Toggle label="Time window" items={WINDOWS} active={f.window} onChange={(window) => rescope({ window })} />
        {hasAdjacent && (
          <Chips
            items={[
              { key: "competitor", label: "Direct competitors" },
              { key: "inspiration", label: "Adjacent niches" },
              { key: "all", label: "All advertisers" },
            ]}
            active={f.relation ?? "all"}
            onChange={(k) => rescope({ relation: k === "all" ? null : (k as InsightFilters["relation"]) })}
          />
        )}
      </div>
      <p className="text-[13px] text-fg-3 mb-4 max-w-[760px]">{RULE[f.window]} Click a row or a cell to see its ads.</p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat label={f.dim === "landing" ? "Ads" : "Profiled ads"} value={table.total} hint={f.window === "14d" ? "launched in 14 days" : "ad cards"} />
        <Stat label={WORKING[f.window]} value={table.working} hint={table.total ? `${pct(table.working / table.total)} of them` : undefined} tone={table.working ? "accent" : "neutral"} />
        <Stat label="Advertisers" value={advertisers} />
        <Stat label="Not profiled yet" value={table.unprofiled} hint={table.unprofiled ? "mostly short tests, never profiled" : undefined} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <Toggle label="Group by" items={(Object.keys(INSIGHT_DIMS) as InsightDim[]).map((key) => ({ key, label: INSIGHT_DIMS[key] }))} active={f.dim} onChange={(dim) => rescope({ dim })} />
        <Toggle size="sm" label="View" items={VIEWS} active={f.view} onChange={(view) => update({ view, advertiserId: null })} />
      </div>

      {f.view === "totals" ? <TotalsTable rows={table.rows} f={f} onSelect={select} /> : <AdvertiserTable cards={cards} f={f} onSelect={select} />}
      {f.value && (
        <DrillPanel key={`${f.dim}:${f.value}:${f.advertiserId}:${f.window}:${f.relation}`} cards={cards} f={f} slug={slug} fav={fav} onClose={() => update({ value: null, advertiserId: null })} />
      )}
      {f.dim === "hook" && <TopHooks cards={cards} f={f} slug={slug} />}
    </>
  );
}

const rowName = (f: InsightFilters, label: string, active: boolean) => <span className={`font-medium ${f.dim === "landing" ? "num text-[12.5px]" : ""} ${active ? "text-accent" : ""}`}>{label}</span>;

function TotalsTable({ rows, f, onSelect }: { rows: InsightRow[]; f: InsightFilters; onSelect: (value: string) => void }) {
  const columns: Column[] = [
    { label: INSIGHT_DIMS[f.dim] },
    { label: "Ads", align: "right" },
    { label: WORKING[f.window], align: "right" },
    { label: ALIVE[f.window], align: "right", title: "Still running, whatever the rank: a softer signal than working" },
    { label: "Advertisers", align: "right" },
    { label: "Longest running", align: "right", title: "Among this row's ads that are still running" },
    ...(f.window === "all" ? [{ label: "New in 30d", align: "right" as const }] : []),
  ];
  const data: Row[] = rows.map((r) => {
    const active = f.value === r.value && !f.advertiserId;
    return {
      id: r.value,
      onClick: () => onSelect(r.value),
      className: active ? "!bg-accent-soft" : "cursor-pointer",
      search: r.label,
      cells: [
        { node: rowName(f, r.label, active), value: r.label },
        { node: <Pair top={<span className="num">{r.ads}</span>} sub={`${pct(r.adShare)} of ads`} />, value: r.ads },
        {
          node: r.working ? (
            <Pair
              strong
              top={<span className="num text-accent">{r.working}</span>}
              sub={r.top && (r.working === 1 ? r.top.name : r.top.working === r.working ? `all ${r.top.name}` : `${r.top.working} from ${r.top.name}`)}
            />
          ) : (
            "–"
          ),
          value: r.working,
          dim: !r.working,
        },
        { node: r.alive ? <span className="num">{r.alive}</span> : "–", value: r.alive, dim: !r.alive },
        { node: <span className="num">{r.advertisers}</span>, value: r.advertisers },
        { node: r.longest != null ? <span className="num">{r.longest}d</span> : "–", value: r.longest, dim: r.longest == null },
        ...(f.window === "all" ? [{ node: r.recent ? <span className="num">{r.recent}</span> : "–", value: r.recent, dim: !r.recent }] : []),
      ],
    };
  });
  return (
    <DataTable dense stickyFirst columns={columns} rows={data} searchLabel={`Search ${INSIGHT_DIMS[f.dim].toLowerCase()}s`} defaultSort={{ col: 2, dir: "desc" }} empty="No ads in this window yet." />
  );
}

function AdvertiserTable({ cards, f, onSelect }: { cards: AdCard[]; f: InsightFilters; onSelect: (value: string, advertiserId?: string | null) => void }) {
  const m = useMemo(() => advertiserMatrix(cards, f), [cards, f]);
  const columns: Column[] = [
    { label: INSIGHT_DIMS[f.dim] },
    { label: "Ads", align: "right" },
    ...m.columns.map((c) => ({
      align: "right" as const,
      title: `${c.name}: ${c.ads} ads, ${c.working} ${WORKING[f.window].toLowerCase()}, ${c.alive} ${ALIVE[f.window].toLowerCase()}${c.relation === "inspiration" ? " · adjacent niche" : ""}`,
      label: (
        <span className="inline-flex flex-col items-end leading-tight normal-case">
          <span className="max-w-[140px] truncate">{c.name}</span>
          <span className="text-[10.5px] text-fg-3">
            {c.relation === "inspiration" ? "adjacent · " : ""}
            {c.working} {WORKING[f.window].toLowerCase()}
          </span>
        </span>
      ),
    })),
  ];
  const data: Row[] = m.rows.map((r) => ({
    id: r.value,
    onClick: () => onSelect(r.value),
    className: f.value === r.value && !f.advertiserId ? "!bg-accent-soft" : "cursor-pointer",
    search: r.label,
    cells: [
      { node: rowName(f, r.label, f.value === r.value), value: r.label },
      { node: <span className="num">{r.ads}</span>, value: r.ads },
      ...m.columns.map((c) => {
        const cell = r.cells[c.id];
        if (!cell) return { node: "", value: 0 };
        const active = f.value === r.value && f.advertiserId === c.id;
        return {
          value: cell.ads,
          node: (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelect(r.value, c.id);
              }}
              title={`${c.name}: ${cell.ads} ads · ${cell.working} ${WORKING[f.window].toLowerCase()} · ${cell.alive} ${ALIVE[f.window].toLowerCase()} · ${pct(cell.ads / c.ads)} of its ads`}
              className={`inline-flex flex-col items-end leading-tight min-w-[52px] rounded-[3px] px-1.5 py-1 -my-1 transition-colors duration-150 hover:outline hover:outline-1 hover:outline-fg-3 ${active ? "outline outline-2 outline-accent" : ""} ${cell.working ? "bg-accent-soft" : ""}`}
            >
              <span className={`num ${cell.working ? "font-semibold" : "text-fg-2"}`}>{cell.ads}</span>
              {cell.working > 0 && (
                <span className="text-[11px] text-accent font-medium">
                  {cell.working} {WORKING[f.window].toLowerCase()}
                </span>
              )}
            </button>
          ),
        };
      }),
    ],
  }));
  return (
    <DataTable dense stickyFirst columns={columns} rows={data} searchLabel={`Search ${INSIGHT_DIMS[f.dim].toLowerCase()}s`} defaultSort={{ col: 1, dir: "desc" }} empty="No ads in this window yet." />
  );
}

/** The selected row's or cell's ads, as feed cards: working first, then the softer signal, then everything. */
function DrillPanel({ cards, f, slug, fav, onClose }: { cards: AdCard[]; f: InsightFilters; slug: string; fav: Favorites<AdCard>; onClose: () => void }) {
  const drill = useMemo(() => drillCards(cards, f), [cards, f]);
  const [mode, setMode] = useState<DrillMode>(drill?.working.length ? "working" : drill?.alive.length ? "alive" : "all");
  const [limit, setLimit] = useState(DRILL_PAGE);
  const [openId, setOpenId] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }, []);
  if (!drill) return null;
  const list = drill[mode];
  const shown = list.slice(0, limit);
  const openIndex = openId ? list.findIndex((c) => c.id === openId) : -1;
  const openAd = openIndex >= 0 ? list[openIndex]! : null;
  const step = (d: number) => {
    const next = list[openIndex + d];
    if (!next) return;
    setOpenId(next.id);
    if (openIndex + d >= limit) setLimit((l) => l + DRILL_PAGE);
  };
  const modes: { key: DrillMode; label: string }[] = [
    { key: "working", label: `${WORKING[f.window]} · ${drill.working.length}` },
    { key: "alive", label: `${ALIVE[f.window]} · ${drill.alive.length}` },
    { key: "all", label: `All · ${drill.all.length}` },
  ];
  return (
    <section ref={ref} className="mb-6 scroll-mt-4" aria-label="Ads behind the selected row">
      <SectionHead
        right={
          <span className="flex items-center gap-3">
            <Link href={browseHref(slug, f, { value: f.value!, advertiserId: f.advertiserId ?? undefined, mode })} className="text-[12.5px] text-fg-2 hover:text-fg">
              Open in Competitor ads →
            </Link>
            <button type="button" onClick={onClose} className="btn btn-sm btn-ghost" aria-label="Close">
              ×
            </button>
          </span>
        }
      >
        {INSIGHT_DIMS[f.dim]}: {drill.label}
        {drill.advertiser ? ` · ${drill.advertiser}` : ""}
      </SectionHead>
      <div className="mb-3">
        <Toggle
          size="sm"
          label="Which ads"
          items={modes}
          active={mode}
          onChange={(m) => {
            setMode(m);
            setLimit(DRILL_PAGE);
          }}
        />
      </div>
      {shown.length ? (
        <AdGrid ads={shown} slug={slug} onOpen={setOpenId} fav={fav} />
      ) : (
        <p className="text-[13px] text-fg-3 py-6">None of these ads {mode === "working" ? `count as ${WORKING[f.window].toLowerCase()}` : "are still running"} yet.</p>
      )}
      {list.length > limit && (
        <div className="mt-4 flex justify-center">
          <button type="button" className="btn btn-sm" onClick={() => setLimit((l) => l + DRILL_PAGE)}>
            Show {Math.min(DRILL_PAGE, list.length - limit)} more of {list.length - limit}
          </button>
        </div>
      )}
      <AdPreview
        ad={openAd}
        slug={slug}
        fav={fav}
        position={openAd ? `${openIndex + 1} / ${list.length}` : ""}
        onClose={() => setOpenId(null)}
        onPrev={openIndex > 0 ? () => step(-1) : null}
        onNext={openIndex >= 0 && openIndex < list.length - 1 ? () => step(1) : null}
      />
    </section>
  );
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
              {card.profile?.fields.hook_type && (
                <Badge>
                  {INSIGHT_DIMS.hook.toLowerCase()}: {card.profile.fields.hook_type.replace(/_/g, " ")}
                </Badge>
              )}
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
