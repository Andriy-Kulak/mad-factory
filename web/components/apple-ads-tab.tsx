"use client";

import Link from "next/link";
import { useTab } from "@/lib/use-tab";
import { sumInto, summarizeBids, zero, type BidSummary, type Totals } from "@/lib/apple-ads-math";
import type { Blocker, ExperimentSummary, NegativeSummary, RevenueCatStatus } from "@/lib/apple-ads";
import { fmtDateTime } from "@/lib/format";
import { Shell } from "@/components/shell";
import { Badge, Card, Empty, NameCell, Pair, SectionHead, Stat, Tabs, type BadgeTone } from "@/components/ui";
import { DataTable, type Cell, type Column, type Row } from "@/components/data-table";
import { DateRangeForm } from "@/components/meta-ads";
import { SpendChart, type DayPoint } from "@/components/spend-chart";
import { PageSkeleton } from "@/components/skeleton";
import { TabLoadError } from "@/components/tab-load-error";

const RANGES = [2, 7, 14, 28, 90];
const TERMS_PER_KEYWORD = 5;
const money = (n: number) => `$${n.toFixed(2)}`;
const int = (n: number) => n.toLocaleString("en-US");
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "–");
const per = (spend: number, n: number) => (n ? money(spend / n) : "–");
const bidRange = (b: BidSummary | null) => (b == null ? "–" : b.min === b.max ? money(b.min) : `${money(b.min)}–${money(b.max)}`);
const isoDay = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null);
const shortDay = (ts: string) => new Date(`${ts.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Marks a search term that a negative keyword blocks now. */
function Blocked({ b }: { b: Blocker | null }) {
  if (!b) return null;
  return (
    <span className="ml-2" title={`negative "${b.text}" (${b.matchType.toLowerCase()})${b.since ? ` added ${b.since.slice(0, 10)}` : ""}`}>
      <Badge tone="red">blocked{b.since ? ` ${shortDay(b.since)}` : ""}</Badge>
    </span>
  );
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/**
 * Apple Ads metrics, then RevenueCat's, paired so tables stay one screen wide: Spend · Impr (tap rate) · Taps ·
 * Installs (install rate) · $/install · Trials ($/trial) · Paid ($/paid) · Revenue. RevenueCat columns appear only
 * when `outcomes` and some row has them (search terms can't be split by RevenueCat).
 */
function appleMetrics(all: Totals[], outcomes = true): { columns: Column[]; cells: (t: Totals) => Cell[] } {
  const show = outcomes && all.some((t) => t.trials || t.paid || t.revenue);
  const cost = (t: Totals, n: number) => (n ? t.spend / n : null);
  const defs: { col: Column; cell: (t: Totals) => Cell }[] = [
    { col: { label: "Spend", align: "right" }, cell: (t) => ({ node: money(t.spend), value: t.spend, dim: !t.spend }) },
    {
      col: { label: "Impr · tap rate", align: "right" },
      cell: (t) => ({ node: <Pair top={compact.format(t.impressions)} sub={pct(t.taps, t.impressions)} />, value: t.impressions, dim: !t.impressions }),
    },
    { col: { label: "Taps", align: "right" }, cell: (t) => ({ node: int(t.taps), value: t.taps, dim: !t.taps }) },
    {
      col: { label: "Installs", align: "right", title: "Installs, install rate (installs ÷ taps) underneath" },
      cell: (t) => ({ node: <Pair top={int(t.installs)} sub={t.taps ? pct(t.installs, t.taps) : null} />, value: t.installs, dim: !t.installs }),
    },
    { col: { label: "$ / install", align: "right", firstDir: "asc" }, cell: (t) => ({ node: per(t.spend, t.installs), value: cost(t, t.installs), dim: !t.installs }) },
    ...(show
      ? ([
          {
            col: { label: "Trials", align: "right", title: "RevenueCat trials, cost per trial underneath" },
            cell: (t: Totals) => ({
              node: <Pair top={int(t.trials)} sub={t.trials ? <span className="font-semibold text-fg-2">{per(t.spend, t.trials)}</span> : null} />,
              value: t.trials,
              dim: !t.trials,
            }),
          },
          {
            col: { label: "Paid", align: "right", title: "RevenueCat paid subscriptions, cost per paid underneath" },
            cell: (t: Totals) => ({ node: <Pair top={int(t.paid)} sub={t.paid ? per(t.spend, t.paid) : null} />, value: t.paid, dim: !t.paid }),
          },
          { col: { label: "Revenue", align: "right", title: "RevenueCat proceeds, after Apple's cut" }, cell: (t: Totals) => ({ node: money(t.revenue), value: t.revenue, dim: !t.revenue }) },
        ] as { col: Column; cell: (t: Totals) => Cell }[])
      : []),
  ];
  return { columns: defs.map((d) => d.col), cells: (t) => defs.map((d) => d.cell(t)) };
}

const appleTone = (displayStatus: string | null, status: string) => (displayStatus === "RUNNING" ? "green" : status === "PAUSED" || displayStatus === "PAUSED" ? "neutral" : "red") as BadgeTone;
const appleState = (displayStatus: string | null, status: string) => (displayStatus === "RUNNING" ? null : (displayStatus ?? status).toLowerCase().replace(/_/g, " "));

const NEGATIVE_COLUMNS: Column[] = [
  { label: "Negative" },
  { label: "Campaign" },
  { label: "Level" },
  { label: "Match" },
  { label: "Status" },
  { label: "Added", firstDir: "desc" },
  { label: "Keyword in" },
  { label: "Impr", align: "right" },
  { label: "Taps", align: "right" },
  { label: "Installs", align: "right" },
  { label: "Spend", align: "right" },
  { label: "Impr since added", align: "right" },
];
function negativeRow(n: NegativeSummary): Row {
  const dim = n.matched.impressions === 0;
  return {
    id: String(n.id),
    cells: [
      { node: <span className="font-semibold">{n.text}</span>, value: n.text },
      { node: n.campaignName, dim: true },
      { node: n.adGroupId == null ? "campaign" : "ad group", dim: true },
      { node: n.matchType.toLowerCase(), dim: true },
      { node: <Badge tone={n.status === "ENABLED" ? "red" : "neutral"}>{n.status === "ENABLED" ? "blocking" : n.status}</Badge>, value: n.status },
      { node: n.addedAt ? shortDay(n.addedAt) : "–", value: n.addedAt, dim: true },
      { node: n.keywordIn.length ? n.keywordIn.join(", ") : "–", value: n.keywordIn.join(", "), dim: !n.keywordIn.length },
      { node: int(n.matched.impressions), value: n.matched.impressions, dim },
      { node: int(n.matched.taps), value: n.matched.taps, dim },
      { node: int(n.matched.installs), value: n.matched.installs, dim },
      { node: money(n.matched.spend), value: n.matched.spend, dim },
      { node: n.matchedSinceAdded ? <span className="text-danger font-semibold">{int(n.matchedSinceAdded)}</span> : "0", value: n.matchedSinceAdded, dim: !n.matchedSinceAdded },
    ],
  };
}

const LOG_SHOWN = 2;

function LogList({ entries }: { entries: (ExperimentSummary["log"][number] & { planName: string | null })[] }) {
  return (
    <ol className="text-[13px] [&_li]:border-t [&_li]:border-line">
      {entries.map((l) => (
        <li key={l.id} className="py-2 flex gap-3">
          <span className="num text-xs text-fg-3 whitespace-nowrap pt-0.5">{fmtDateTime(l.at)}</span>
          <Badge tone={l.kind === "change" ? "green" : "neutral"}>{l.kind}</Badge>
          <div className="min-w-0">
            <span className="whitespace-pre-wrap">{l.body}</span>
            <div className="num text-xs text-fg-3 mt-0.5">
              {l.actor}
              {l.planName && ` · ${l.planName}`}
              {l.source_url && (
                <>
                  {" "}
                  ·{" "}
                  <a className="underline" href={l.source_url}>
                    source
                  </a>
                </>
              )}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

type ExperimentView = Omit<ExperimentSummary, "experiment" | "log"> & {
  experiment: ExperimentSummary["experiment"] & { writeupName: string | null };
  log: (ExperimentSummary["log"][number] & { planName: string | null })[];
};

function ExperimentPanel({ e, names, bids }: { e: ExperimentView; names: Map<string, string>; bids: Map<string, BidSummary | null> }) {
  const x = e.experiment;
  const running = x.status === "running";
  const capToDate = x.daily_budget == null ? null : Number(x.daily_budget) * (e.length == null ? e.day : Math.min(e.day, e.length));
  const roles = new Map<string, Totals>();
  for (const l of e.links) {
    const key = `${l.role ?? "–"} · ${l.geo ?? "–"}`;
    const t = roles.get(key) ?? roles.set(key, zero()).get(key)!;
    const c = e.byCampaign[Number(l.external_campaign_id)];
    if (c) sumInto(t, c);
  }
  const roleM = appleMetrics([...roles.values()]);
  return (
    <Card className="p-5 mb-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-1">
        <span className="label">Experiment</span>
        <Badge tone={running ? "green" : "neutral"}>{x.status}</Badge>
        <span className="num text-xs text-fg-3">
          {x.start_date} → {x.end_date ?? "open"}
          {e.length != null && ` · day ${Math.min(e.day, e.length)} of ${e.length}`}
        </span>
      </div>
      <h2 className="text-[17px] font-semibold">{x.name}</h2>
      {x.hypothesis && <p className="text-fg-2 text-[13px] mt-1 max-w-3xl">{x.hypothesis}</p>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-3 mt-4">
        <div>
          <div className="label">Spend so far</div>
          <div className="num text-[20px]">
            {money(e.totals.spend)}
            {capToDate != null && <span className="text-fg-3 text-xs ml-2">of {money(capToDate)} cap to date</span>}
          </div>
        </div>
        <div>
          <div className="label">Yesterday</div>
          <div className="num text-[20px]">
            {money(e.yesterdaySpend)}
            {x.daily_budget != null && <span className="text-fg-3 text-xs ml-2">of {money(Number(x.daily_budget))}</span>}
          </div>
        </div>
        <div>
          <div className="label">Taps · installs</div>
          <div className="num text-[20px]">
            {int(e.totals.taps)} · {int(e.totals.installs)}
          </div>
        </div>
        <div>
          <div className="label">Cost per install</div>
          <div className="num text-[20px]">
            {per(e.totals.spend, e.totals.installs)}
            <span className="text-fg-3 text-xs ml-2">{e.totals.trials ? `${per(e.totals.spend, e.totals.trials)} per trial (${int(e.totals.trials)})` : "no attributed trials"}</span>
          </div>
        </div>
      </div>

      <DataTable
        dense
        stickyFirst
        className="mt-4"
        columns={[{ label: "Campaign type · geo" }, { label: "Bids", align: "right" }, ...roleM.columns]}
        rows={[...roles].map(([key, t]) => {
          const links = e.links.filter((l) => `${l.role ?? "–"} · ${l.geo ?? "–"}` === key);
          const campaigns = links.map((l) => names.get(l.external_campaign_id) ?? l.external_campaign_id).join(", ");
          const bid = summarizeBids(
            links.flatMap((l) => {
              const b = bids.get(l.external_campaign_id);
              return b ? [b.min, b.max] : [];
            }),
          );
          return {
            id: key,
            cells: [{ node: <NameCell name={key} sub={campaigns} />, value: key }, { node: bidRange(bid), value: bid?.max ?? null }, ...roleM.cells(t)],
          };
        })}
      />

      {x.success_criteria && (
        <p className="text-xs text-fg-3 mt-4 max-w-3xl">
          <span className="label mr-2">Success criteria</span>
          {x.success_criteria}
        </p>
      )}
      {x.writeupName && <p className="num text-xs text-fg-3 mt-1">write-up: {x.writeupName}</p>}

      <div className="mt-5">
        <div className="label mb-2">Log</div>
        {e.log.length === 0 ? (
          <p className="text-xs text-fg-3">
            No entries yet. Add one with <code className="num">pnpm experiment log --product … --experiment {x.slug} --kind decision "…"</code>.
          </p>
        ) : (
          <>
            <LogList entries={e.log.slice(0, LOG_SHOWN)} />
            {e.log.length > LOG_SHOWN && (
              <details className="group/log">
                <summary className="text-xs text-fg-2 hover:text-fg list-none py-2 [&::-webkit-details-marker]:hidden">
                  <span className="group-open/log:hidden">Show {e.log.length - LOG_SHOWN} older entries</span>
                  <span className="hidden group-open/log:inline">Hide older entries</span>
                </summary>
                <LogList entries={e.log.slice(LOG_SHOWN)} />
              </details>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

/** Whether trials in the tables can be trusted: RevenueCat synced, and receiving Apple Ads attribution. */
function RevenueCatNote({ rc }: { rc: RevenueCatStatus | null }) {
  if (!rc) {
    return (
      <p className="text-xs text-fg-3 mb-6">
        Trials, paid and revenue columns come from RevenueCat and are empty until it syncs: <code className="num">pnpm revenuecat sync --all</code>.
      </p>
    );
  }
  const share = rc.all.trials ? Math.round((100 * rc.attributed.trials) / rc.all.trials) : 0;
  return (
    <p className={`text-xs mb-6 ${rc.attributed.trials || rc.attributed.paid ? "text-fg-3" : "text-danger"}`}>
      RevenueCat in range: {int(rc.all.trials)} trials, {int(rc.all.paid)} paid, {money(rc.all.revenue)} revenue, of which {int(rc.attributed.trials)} trials ({share}%) and{" "}
      {money(rc.attributed.revenue)} are attributed to Apple Ads.
      {!rc.attributed.trials && !rc.attributed.paid && " Nothing is attributed: check RevenueCat's Apple Search Ads integration."} Credited to the install keyword, not the search term. Revenue is
      proceeds, after Apple's cut and taxes. RevenueCat last synced {fmtDateTime(rc.lastSyncedAt)}.
    </p>
  );
}

type View = "overview" | "experiments" | "keywords";

export function AppleAdsTab({ product, params, view: requestedView }: { product: { id: string; slug: string }; params: { days?: string; from?: string; to?: string }; view?: string }) {
  const { data, isPending, isError, refetch } = useTab(product, "apple-ads", params);
  if (isPending) return <PageSkeleton title="Apple ads" stats={0} body="table" />;
  if (isError || !data) return <TabLoadError title="Apple ads" retry={() => void refetch()} />;
  const { slug } = product;
  const sp = params;
  const today = new Date().toISOString().slice(0, 10);
  const from = isoDay(sp.from);
  const to = isoDay(sp.to) ?? today;
  const custom = from != null && from <= to;
  const requested = Number(sp.days);
  const days = RANGES.includes(requested) ? requested : 28;
  const range = custom ? { since: from, until: to } : { since: new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10), until: today };
  const view: View = requestedView === "experiments" || requestedView === "keywords" ? requestedView : "overview";
  const rangeQs = custom ? `from=${range.since}&to=${range.until}` : days !== 28 ? `days=${days}` : "";
  const viewHref = (v: View) => {
    const q = [v !== "overview" ? `view=${v}` : "", rangeQs].filter(Boolean).join("&");
    return `/p/${slug}/apple-ads${q ? `?${q}` : ""}`;
  };
  const rangeLabel = custom ? `${shortDay(range.since)} – ${shortDay(range.until)}` : `last ${days} days`;
  const { overview: o, experiments } = data;
  const linkOf = new Map(experiments.filter((e) => e.experiment.status === "running").flatMap((e) => e.links.map((l) => [l.external_campaign_id, l] as const)));

  const ranges = (
    <div className="flex flex-wrap items-center gap-2 shrink-0">
      <nav aria-label="Range" className="segmented">
        {RANGES.map((d) => (
          <Link key={d} href={`/p/${slug}/apple-ads?${view !== "overview" ? `view=${view}&` : ""}days=${d}`} aria-current={!custom && d === days ? "page" : undefined}>
            {d}D
          </Link>
        ))}
      </nav>
      <DateRangeForm action={`/p/${slug}/apple-ads`} since={range.since} until={range.until} max={today} custom={custom} extra={view !== "overview" ? { view } : {}} />
    </div>
  );

  if (!o.campaigns.length) {
    return (
      <Shell title="Apple ads" subtitle={product.slug}>
        <Empty>
          No Apple Ads campaigns synced for this product. Track the app with <code className="num">pnpm product add-source … --source apple_ads --kind app</code>, then run{" "}
          <code className="num">pnpm apple-ads sync --product {slug}</code>.
        </Empty>
      </Shell>
    );
  }

  const active = o.negatives.filter((n) => n.matched.impressions > 0 || (n.addedAt != null && n.addedAt.slice(0, 10) >= o.since));
  const quiet = o.negatives.filter((n) => !active.includes(n));
  const dailyCap = o.campaigns.filter((c) => c.status === "ENABLED").reduce((s, c) => s + Number(c.daily_budget ?? 0), 0);
  const unserved = o.campaigns.reduce((s, c) => s + c.unserved, 0);
  // Days without activity have no rows; fill them with zeros so the line is honest about gaps.
  const byDate = new Map(o.days.map((d) => [d.date, d]));
  const series: DayPoint[] = [];
  const last = o.until;
  for (let d = new Date(`${o.since}T12:00:00Z`); d.toISOString().slice(0, 10) <= last; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    const t = byDate.get(date);
    series.push({ date, spend: t?.spend ?? 0, impressions: t?.impressions ?? 0, taps: t?.taps ?? 0, installs: t?.installs ?? 0, trials: t?.trials ?? 0 });
  }

  const names = new Map(o.campaigns.map((c) => [String(c.id), c.name]));
  const bids = new Map(o.campaigns.map((c) => [String(c.id), c.bid]));
  const running = experiments.filter((e) => e.experiment.status === "running");
  const campaignM = appleMetrics(o.campaigns.map((c) => c.totals));
  const keywordM = appleMetrics(o.keywords.map((k) => k.totals));
  const termM = appleMetrics([], false);
  const tabs = (
    <Tabs
      active={view}
      items={[
        { key: "overview", label: "Overview", href: viewHref("overview") },
        {
          key: "experiments",
          label: (
            <>
              Experiments <span className="text-[12px] text-fg-3 font-normal ml-1">{running.length} running</span>
            </>
          ),
          href: viewHref("experiments"),
        },
        {
          key: "keywords",
          label: (
            <>
              Keywords & search terms <span className="text-[12px] text-fg-3 font-normal ml-1">{o.keywords.length}</span>
            </>
          ),
          href: viewHref("keywords"),
        },
      ]}
    />
  );

  return (
    <Shell title="Apple ads" subtitle={`since ${o.since} · last sync ${fmtDateTime(o.lastSyncedAt)}`} action={ranges} tabs={tabs}>
      {view === "experiments" &&
        (experiments.length === 0 ? (
          <Empty>
            No experiments yet. Create one with <code className="num">pnpm experiment upsert</code>.
          </Empty>
        ) : (
          experiments.map((e) => <ExperimentPanel key={e.experiment.id} e={e} names={names} bids={bids} />)
        ))}

      {view === "overview" && (
        <>
          {running.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-5">
              {running.map((e) => (
                <Link key={e.experiment.id} href={viewHref("experiments")} className="card px-3 py-2 flex items-center gap-3 text-[13px] hover:border-fg-3 transition-colors duration-150">
                  <Badge tone="green">running</Badge>
                  <span className="font-medium">{e.experiment.name}</span>
                  <span className="num text-fg-3 text-xs">
                    {e.length != null ? `day ${Math.min(e.day, e.length)}/${e.length} · ` : ""}
                    {money(e.totals.spend)} · {per(e.totals.spend, e.totals.installs)}/install
                  </span>
                  <span className="text-fg-3">→</span>
                </Link>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-3">
            <Stat label="Spend" value={money(o.totals.spend)} hint={`${rangeLabel} · enabled daily cap ${money(dailyCap)}`} />
            <Stat label="Impressions" value={int(o.totals.impressions)} />
            <Stat label="Taps" value={int(o.totals.taps)} hint={`tap rate ${pct(o.totals.taps, o.totals.impressions)}`} />
            <Stat label="Installs" value={int(o.totals.installs)} hint={`${per(o.totals.spend, o.totals.installs)} per install`} />
            <Stat label="Trials" value={int(o.totals.trials)} hint={`${per(o.totals.spend, o.totals.trials)} per trial · ${money(o.totals.revenue)} revenue`} />
            <Stat label="Keywords" value={o.keywords.length} hint={`${unserved} with no impressions in range`} />
          </div>
          <RevenueCatNote rc={o.revenuecat} />

          <SectionHead>Campaigns</SectionHead>
          <DataTable
            dense
            stickyFirst
            columns={[
              { label: "Campaign" },
              { label: "Budget / day", align: "right" },
              { label: "Keywords", align: "right", title: "Targeting keywords; how many had no impressions in range underneath" },
              { label: "Bid", align: "right", title: "Average keyword bid; range underneath" },
              { label: "Negatives", align: "right" },
              ...campaignM.columns,
            ]}
            defaultSort={{ col: 5, dir: "desc" }}
            views={[
              { key: "all", label: "All" },
              { key: "running", label: "Running" },
              { key: "test", label: "In a test" },
            ]}
            rows={o.campaigns.map((c) => {
              const link = linkOf.get(String(c.id));
              return {
                id: String(c.id),
                tags: [c.display_status === "RUNNING" ? "running" : "", link ? "test" : ""].filter(Boolean),
                cells: [
                  {
                    node: (
                      <NameCell
                        name={c.name}
                        id={String(c.id)}
                        tone={appleTone(c.display_status, c.status)}
                        state={appleState(c.display_status, c.status)}
                        sub={[link ? `test: ${link.role ?? "–"} · ${link.geo ?? "–"}` : null, c.countries.length > 6 ? `${c.countries.length} countries` : c.countries.join(" ")]
                          .filter(Boolean)
                          .join(" · ")}
                      />
                    ),
                    value: c.name,
                  },
                  { node: c.daily_budget == null ? "–" : money(Number(c.daily_budget)), value: c.daily_budget == null ? null : Number(c.daily_budget) },
                  { node: <Pair top={c.keywords} sub={c.unserved ? `${c.unserved} unserved` : null} />, value: c.keywords },
                  {
                    node: <Pair top={c.bid == null ? "–" : money(c.bid.avg)} sub={c.bid != null && c.bid.min !== c.bid.max ? bidRange(c.bid) : null} />,
                    value: c.bid?.avg ?? null,
                    dim: c.bid == null,
                  },
                  { node: c.negatives, value: c.negatives, dim: !c.negatives },
                  ...campaignM.cells(c.totals),
                ],
              };
            })}
          />

          <div className="grid lg:grid-cols-2 gap-x-3">
            <div className="min-w-0">
              <SectionHead>Spend by day</SectionHead>
              <Card className="p-4 mb-6">
                <SpendChart days={series} />
                <details className="mt-2 text-xs">
                  <summary className="text-fg-3">Table view</summary>
                  <table className="num w-full mt-2">
                    <tbody>
                      {series.map((d) => (
                        <tr key={d.date} className="border-t border-line">
                          <td className="py-1 text-fg-3">{d.date}</td>
                          <td className="text-right">{money(d.spend)}</td>
                          <td className="text-right text-fg-3">{int(d.impressions)} impr</td>
                          <td className="text-right text-fg-3">{d.taps} taps</td>
                          <td className="text-right text-fg-3">{d.installs} installs</td>
                          <td className="text-right text-fg-3">{d.trials} trials</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </Card>
            </div>
            <div className="min-w-0">
              <SectionHead>By country</SectionHead>
              {/* Every country, scrolling inside the card, so a sort is over all of them. */}
              <DataTable
                dense
                maxHeight="26rem"
                columns={[
                  { label: "Country" },
                  { label: "Impr", align: "right" },
                  { label: "Taps", align: "right" },
                  { label: "Installs", align: "right" },
                  { label: "Spend", align: "right" },
                  { label: "Share", align: "right" },
                ]}
                defaultSort={{ col: 4, dir: "desc" }}
                rows={o.countries.map((c) => ({
                  id: c.country,
                  cells: [
                    { node: <span className="font-medium">{c.country}</span>, value: c.country },
                    { node: int(c.impressions), value: c.impressions },
                    { node: int(c.taps), value: c.taps },
                    { node: int(c.installs), value: c.installs },
                    { node: money(c.spend), value: c.spend },
                    { node: pct(c.spend, o.totals.spend), value: o.totals.spend ? c.spend / o.totals.spend : null },
                  ],
                }))}
              />
            </div>
          </div>
        </>
      )}

      {view === "keywords" && (
        <>
          <RevenueCatNote rc={o.revenuecat} />
          <SectionHead right={<span className="text-xs text-fg-3">↳ search terms that triggered each keyword</span>}>Keywords</SectionHead>
          <DataTable
            dense
            stickyFirst
            maxHeight="75vh"
            searchLabel="Search keywords and campaigns"
            views={[
              { key: "all", label: "All" },
              { key: "running", label: "Running" },
              { key: "unserved", label: "No impressions" },
            ]}
            columns={[{ label: "Keyword" }, { label: "Bid", align: "right" }, ...keywordM.columns]}
            defaultSort={{ col: 2, dir: "desc" }}
            rows={o.keywords.flatMap((k): Row[] => {
              const terms = k.terms.filter((t) => t.impressions > 0);
              const onlyItself = terms.every((t) => t.term === "" || t.term.toLowerCase() === k.text.toLowerCase());
              const shown = onlyItself ? [] : terms.slice(0, TERMS_PER_KEYWORD);
              const cells: Cell[] = [
                {
                  node: (
                    <NameCell
                      name={k.text}
                      id={String(k.id)}
                      tone={appleTone(k.display_status, k.status)}
                      state={appleState(k.display_status, k.status)}
                      sub={[k.campaignName, k.match_type.toLowerCase(), k.negativeIn.length ? `negative in ${k.negativeIn.join(", ")}` : null].filter(Boolean).join(" · ")}
                    />
                  ),
                  value: k.text,
                },
                { node: k.bid == null ? "–" : money(Number(k.bid)), value: k.bid == null ? null : Number(k.bid) },
                ...keywordM.cells(k.totals),
              ];
              const tags = [k.display_status === "RUNNING" ? "running" : "", k.totals.impressions === 0 ? "unserved" : ""].filter(Boolean);
              const search = `${k.text} ${k.campaignName} ${terms.map((t) => t.term).join(" ")}`;
              // Term rows sort by their keyword's values, so the stable sort keeps them right under it.
              const under = (sub: Cell[]) => sub.map((c, i) => ({ ...c, value: cells[i]!.value }));
              const termCells = (t: Totals) => {
                const tc = termM.cells(t);
                return keywordM.columns.map((_, i): Cell => tc[i] ?? { node: null });
              };
              return [
                { id: String(k.id), cells, tags, search },
                ...shown.map((t) => ({
                  id: `${k.id}|${t.term}`,
                  tags,
                  search,
                  className: "!border-t-0 text-fg-2",
                  cells: under([
                    {
                      className: "pl-7 !py-1",
                      node: (
                        <>
                          <span className="text-fg-3 mr-1.5">↳</span>
                          {t.term === "" ? <span className="italic text-fg-3">low volume, withheld by Apple</span> : t.term}
                          <Blocked b={t.blockedBy} />
                        </>
                      ),
                    },
                    { node: null },
                    ...termCells(t),
                  ]),
                })),
                ...(terms.length > shown.length && shown.length > 0
                  ? [
                      {
                        id: `${k.id}#more`,
                        tags,
                        search,
                        className: "!border-t-0",
                        cells: under([
                          { className: "pl-7 !pt-0 pb-2 text-xs text-fg-3 !whitespace-normal", node: `+ ${terms.length - shown.length} more search terms (see Search terms below)` },
                          ...Array.from({ length: cells.length - 1 }, () => ({ node: null })),
                        ]),
                      },
                    ]
                  : []),
              ];
            })}
          />

          <SectionHead right={<span className="text-xs text-fg-3">{o.withheldSearchTermRows} low-volume rows withheld by Apple</span>}>Search terms</SectionHead>
          {o.searchTerms.length === 0 ? (
            <Card className="p-6 mb-6 text-fg-3 text-[13px]">No search terms with visible text yet. Apple hides terms until they have enough volume.</Card>
          ) : (
            <DataTable
              dense
              stickyFirst
              maxHeight="60vh"
              searchLabel="Search terms"
              columns={[{ label: "Search term" }, ...termM.columns]}
              defaultSort={{ col: 1, dir: "desc" }}
              rows={o.searchTerms.slice(0, 100).map((t) => ({
                id: `${t.campaignName}|${t.keyword}|${t.term}`,
                search: `${t.term} ${t.keyword} ${t.campaignName}`,
                cells: [
                  {
                    node: (
                      <span className="inline-flex items-center">
                        <NameCell name={t.term} sub={`${t.keyword} · ${t.campaignName}`} />
                        <Blocked b={t.blockedBy} />
                      </span>
                    ),
                    value: t.term,
                  },
                  ...termM.cells(t),
                ],
              }))}
            />
          )}

          <SectionHead right={<span className="text-xs text-fg-3">keyword-level max CPT bids as of last sync</span>}>Bids by campaign</SectionHead>
          <Card className="mb-6 divide-y divide-line">
            {o.campaigns.map((c) => {
              const kws = o.keywords.filter((k) => k.campaign_id === c.id).sort((a, b) => Number(b.bid ?? 0) - Number(a.bid ?? 0) || a.text.localeCompare(b.text));
              const bidM = appleMetrics(kws.map((k) => k.totals));
              return (
                <details key={c.id} className="group">
                  <summary className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 h-11 list-none text-[13px] hover:bg-bg-3 transition-colors duration-150 [&::-webkit-details-marker]:hidden">
                    <span className="text-fg-3 w-3 group-open:rotate-90 transition-transform">›</span>
                    <span className="font-semibold">{c.name}</span>
                    <span className="num text-fg-2">avg {c.bid == null ? "–" : money(c.bid.avg)}</span>
                    <span className="num text-fg-3 text-xs">
                      {bidRange(c.bid)} · {c.keywords} keyword{c.keywords === 1 ? "" : "s"}
                    </span>
                  </summary>
                  {kws.length === 0 ? (
                    <p className="px-4 pb-3 text-xs text-fg-3">No targeting keywords.</p>
                  ) : (
                    <DataTable
                      dense
                      className="mx-4 mb-3"
                      columns={[{ label: "Keyword" }, { label: "Bid", align: "right" }, { label: "vs avg", align: "right" }, ...bidM.columns]}
                      defaultSort={{ col: 1, dir: "desc" }}
                      rows={kws.map((k) => {
                        const diff = k.bid == null || c.bid == null ? null : Number(k.bid) - c.bid.avg;
                        return {
                          id: String(k.id),
                          cells: [
                            {
                              node: <NameCell name={k.text} tone={appleTone(k.display_status, k.status)} state={appleState(k.display_status, k.status)} sub={k.match_type.toLowerCase()} />,
                              value: k.text,
                            },
                            { node: k.bid == null ? "–" : money(Number(k.bid)), value: k.bid == null ? null : Number(k.bid) },
                            { node: diff == null ? "–" : `${diff >= 0 ? "+" : "−"}${money(Math.abs(diff))}`, value: diff, dim: true },
                            ...bidM.cells(k.totals),
                          ],
                        };
                      })}
                    />
                  )}
                </details>
              );
            })}
          </Card>

          <SectionHead
            right={<span className="text-xs text-fg-3">traffic = search terms in range the negative matches, mostly from before it was added; approximate, Apple also blocks close variants</span>}
          >
            Negative keywords
          </SectionHead>
          {o.negatives.length === 0 ? (
            <Card className="p-6 mb-6 text-fg-3 text-[13px]">No negative keywords.</Card>
          ) : (
            <>
              <DataTable dense columns={NEGATIVE_COLUMNS} rows={active.map(negativeRow)} defaultSort={{ col: 7, dir: "desc" }} />
              {quiet.length > 0 && (
                <details className="mb-6 -mt-3">
                  <summary className="text-xs text-fg-3 mb-3">{quiet.length} more negatives with no matching traffic in range, added before it</summary>
                  <DataTable dense columns={NEGATIVE_COLUMNS} rows={quiet.map(negativeRow)} defaultSort={{ col: 5, dir: "desc" }} />
                </details>
              )}
            </>
          )}
        </>
      )}
    </Shell>
  );
}
