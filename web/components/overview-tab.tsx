"use client";

import Link from "next/link";
import { useTab } from "@/lib/use-tab";
import type { ChannelSetup } from "@/lib/setup";
import type { Overview } from "@/lib/overview";
import type { Pipeline } from "@/lib/b2b-social-people";
import { fmtAgo, fmtDate, fmtDateTime, fmtInt, fmtMoney } from "@/lib/format";
import { Shell } from "@/components/shell";
import { TrendChart } from "@/components/trend-chart";
import { DataTable } from "@/components/data-table";
import { Badge, Card, Empty, Meter, SectionHead, Segmented, Stat, StatusDot } from "@/components/ui";
import { PageSkeleton } from "@/components/skeleton";
import { TabLoadError } from "@/components/tab-load-error";
import { OVERVIEW_WINDOWS } from "@/lib/tab-constants";

export function OverviewTab({ product, days, present, without }: { product: { id: string; slug: string }; days: number; present: boolean; without?: "apple_ads" }) {
  const { data, isPending, isError, refetch } = useTab(product, "overview", { days: String(days), without });
  if (isPending) return <PageSkeleton title="Overview" stats={4} body="table" />;
  if (isError || !data) return <TabLoadError title="Overview" retry={() => void refetch()} />;
  const { overview: o, channels, brief, pipeline } = data;
  const { slug } = product;
  const connected = (key: ChannelSetup["key"]) => channels.some((c) => c.key === key && c.connected);
  // A product that sells B2B and runs no paid channel is judged by its lead pipeline, not by profit.
  const leads = pipeline && !connected("meta-ads") && !connected("apple") && !connected("revenuecat") ? pipeline : null;
  const href = (d: number, p: boolean, w = without) => `/p/${slug}?days=${d}${p ? "&present=1" : ""}${w ? `&without=${w}` : ""}`;
  // Only Apple can be left out: RevenueCat credits its customers, so its revenue leaves with its spend.
  const hasApple = !!without || connected("apple");

  const action = (
    <div className="flex items-center gap-3">
      {hasApple && (
        <Link
          href={href(days, present, without ? undefined : "apple_ads")}
          role="switch"
          aria-checked={!without}
          className="switch"
          title="Turn off to see every number without Apple ads: its spend and the trials and proceeds RevenueCat credits to it"
        >
          <span className="switch-track" />
          Apple ads
        </Link>
      )}
      <Segmented label="Window" active={String(days)} items={OVERVIEW_WINDOWS.map((d) => ({ key: String(d), label: `${d}D`, href: href(d, present) }))} />
      <Link href={href(days, !present)} className="btn" title="Show only the trend and channel numbers, for a demo">
        {present ? "Exit presenting" : "Present"}
      </Link>
    </div>
  );
  if (leads) {
    const leadAction = (
      <div className="flex items-center gap-2">
        <Segmented label="Window" active={String(days)} items={OVERVIEW_WINDOWS.map((d) => ({ key: String(d), label: `${d}D`, href: href(d, present) }))} />
      </div>
    );
    return (
      <Shell title="Overview" subtitle={`Leads through ${fmtDate(leads.capturedAt)} · refreshed ${fmtDateTime(o.generatedAt)}`} action={leadAction}>
        <LeadGoal p={leads} />
        <TopLeads p={leads} slug={slug} />
        {o.organic.posts.length > 0 && <Organic o={o} slug={slug} />}
      </Shell>
    );
  }

  const subtitle = `Numbers through ${fmtDate(o.window.to)}${without ? " · without Apple ads" : ""} · refreshed ${fmtDateTime(o.generatedAt)}`;

  if (present)
    return (
      <Shell title="Overview" subtitle={subtitle} action={action}>
        <Trend o={o} />
        <Window o={o} slug={slug} />
        <div className="grid xl:grid-cols-2 gap-x-3">
          <MetaAds o={o} slug={slug} />
          <Organic o={o} slug={slug} />
        </div>
      </Shell>
    );

  return (
    <Shell title="Overview" subtitle={subtitle} action={action}>
      <Goal o={o} />
      <Attention o={o} slug={slug} />
      <Setup channels={channels} slug={slug} />
      <Window o={o} slug={slug} />
      <Trend o={o} />
      <div className="grid xl:grid-cols-2 gap-x-3">
        <MetaAds o={o} slug={slug} />
        <Organic o={o} slug={slug} />
      </div>
      <div className="grid xl:grid-cols-2 gap-x-3">
        <Experiments o={o} slug={slug} />
        <Freshness o={o} />
      </div>
      <AgentBrief brief={brief} slug={slug} />
    </Shell>
  );
}

function Goal({ o }: { o: Overview }) {
  const sc = o.scorecard;
  const c = sc.currency;
  const projected = sc.projected?.profit ?? sc.sevenDayPace.profit;
  const status = {
    profitable: <Badge tone="green">Profitable</Badge>,
    not_profitable: <Badge tone="red">Not profitable yet</Badge>,
    no_goal: <Badge tone="warn">No goal set</Badge>,
  }[o.status];
  return (
    <section aria-label="Goal" className="mb-6">
      <Card className="px-5 py-4 mb-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="label">Goal</span>
          <span className="text-[20px] leading-tight font-semibold tracking-[-0.01em]">
            {sc.goal ? (
              <>
                <span className="num">{fmtMoney(sc.goal.target, c)}</span> profit per month
              </>
            ) : (
              "Not set"
            )}
          </span>
          {status}
          <span
            className="ml-auto text-[12px] text-fg-3 underline decoration-dotted underline-offset-2"
            title={`Profit is RevenueCat proceeds (after store fees) minus Apple and Meta ad spend minus fixed costs. Find what earns more than it costs over the last ${o.window.days} days and put more money behind it; attribution older than about 10 days is not reliable.`}
          >
            How profit is counted
          </span>
        </div>
        {sc.goal && <Meter value={projected / sc.goal.target} tone="accent" className="mt-3" />}
      </Card>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          label="Projected this month"
          value={fmtMoney(projected, c)}
          hint={sc.projected ? `at the pace of ${sc.daysElapsed} day(s) so far` : "at the 7-day pace"}
          tone={projected < 0 ? "warn" : "neutral"}
        />
        <Stat label="Gap to goal" value={sc.gap == null ? "–" : fmtMoney(sc.gap, c)} hint={sc.goal ? `goal ${fmtMoney(sc.goal.target, c)}` : "set a goal: pnpm scorecard goal"} />
        <Stat label="Month to date" value={fmtMoney(sc.monthToDate.profit, c)} hint={`${fmtMoney(sc.monthToDate.proceeds, c)} in, ${fmtMoney(sc.monthToDate.spendTotal, c)} spent`} />
        <Stat label={`Last ${o.window.days} days`} value={fmtMoney(o.windowProfit, c)} hint="proceeds minus ad spend" tone={o.windowProfit < 0 ? "warn" : "neutral"} />
      </div>
    </section>
  );
}

/** The goal for a B2B product: qualified leads this month and their pace, then the funnel over the window. */
function LeadGoal({ p }: { p: Pipeline }) {
  const m = p.month;
  return (
    <section aria-label="Goal" className="mb-6">
      <Card className="px-5 py-4 mb-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="label">Goal</span>
          <span className="text-[20px] leading-tight font-semibold tracking-[-0.01em]">Qualified B2B leads per month</span>
          <span
            className="ml-auto text-[12px] text-fg-3 underline decoration-dotted underline-offset-2"
            title="A qualified lead is someone who engaged with a watched post on LinkedIn or X and is graded fit A or B on B2B Social: the right company (Fortune 500, 10k+ employees, or a buyer at a smaller or YC company) and a known role."
          >
            How leads are counted
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="num text-[32px] leading-none font-medium tracking-[-0.02em]">{fmtInt(m.qualified)}</span>
          <span className="text-[14px] text-fg-2">
            this month so far
            {m.projected != null && (
              <>
                {" "}
                · on pace for <span className="num">{fmtInt(m.projected)}</span> by month end
              </>
            )}
          </span>
        </div>
      </Card>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Comments on watched posts" value={fmtInt(p.engaged)} hint={`LinkedIn and X, last ${p.days} days`} />
        <Stat label="Identified" value={fmtInt(p.identified)} hint="name, title or company known" />
        <Stat label="Qualified, fit A or B" value={fmtInt(p.qualified)} hint={`${fmtInt(p.strong)} with the strongest signal`} />
        <Stat label="Reach out now" value={fmtInt(p.now)} hint="routed to a rep today" />
      </div>
    </section>
  );
}

function TopLeads({ p, slug }: { p: Pipeline; slug: string }) {
  return (
    <section aria-label="Top leads" className="mb-6">
      <SectionHead
        right={
          <Link href={`/p/${slug}/b2b-social`} className="text-[13px] text-fg-2 hover:text-fg">
            B2B Social →
          </Link>
        }
      >
        Top leads, last {p.days} days
      </SectionHead>
      <DataTable
        dense
        className=""
        empty="No qualified lead in this window."
        columns={[{ label: "Grade" }, { label: "Person" }, { label: "Company" }, { label: "Why", sortable: false }, { label: "Posted", align: "right" }]}
        rows={p.top.map((r) => ({
          id: r.id,
          href: `/p/${slug}/b2b-social`,
          cells: [
            { node: <Badge tone={r.fit === "A" ? "green" : "accent"}>{r.grade}</Badge>, value: r.grade },
            {
              node: (
                <span className="block max-w-[260px] truncate" title={r.title ?? undefined}>
                  <span className="font-medium">{r.name}</span>
                  {r.title && <span className="text-fg-3"> · {r.title}</span>}
                </span>
              ),
              value: r.name,
            },
            {
              node: (
                <span className="block max-w-[200px] truncate">
                  {r.company ?? "–"}
                  {r.tierLabel && <span className="text-fg-3"> · {r.tierLabel}</span>}
                </span>
              ),
              value: r.company,
            },
            {
              node: (
                <span className="block max-w-[420px] truncate text-fg-2" title={r.quote}>
                  “{r.quote}”
                </span>
              ),
              value: r.quote,
            },
            { node: fmtDate(r.postDate), value: r.postDate, dim: true },
          ],
        }))}
      />
    </section>
  );
}

/** What needs a look today: overdue follow-ups, stale syncs, data warnings, ads spending more per trial than a trial earns. */
function Attention({ o, slug }: { o: Overview; slug: string }) {
  const c = o.scorecard.currency;
  const items: { key: string; tone: "red" | "warn"; label: string; body: string; href?: string }[] = [
    ...o.followUps
      .filter((f) => f.daysOverdue >= 0)
      .map((f) => ({
        key: `f:${f.id}`,
        tone: "warn" as const,
        label: f.daysOverdue > 0 ? `${f.daysOverdue}d overdue` : "due today",
        body: f.body,
        href: f.experiment.startsWith("apple_ads/") ? `/p/${slug}/apple-ads?view=experiments` : undefined,
      })),
    ...o.freshness
      .filter((f) => f.stale)
      .map((f) => ({ key: `s:${f.source}`, tone: "red" as const, label: "stale", body: `${f.source}: last successful sync ${f.lastDone ? fmtAgo(f.lastDone) : "never"}` })),
    ...o.warnings.map((w, i) => ({ key: `w:${i}`, tone: "warn" as const, label: "data", body: w })),
    ...(o.proceedsPerTrial != null
      ? o.ads
          .filter((a) => a.status === "ACTIVE" && a.costPerTrial != null && a.costPerTrial > 2 * o.proceedsPerTrial! && a.spend >= 20)
          .map((a) => ({
            key: `a:${a.id}`,
            tone: "red" as const,
            label: "expensive",
            href: `/p/${slug}/meta-ads`,
            body: `${a.name}: ${fmtMoney(a.costPerTrial!, c, true)} per trial, over 2× the ${fmtMoney(o.proceedsPerTrial!, c, true)} a trial earns`,
          }))
      : []),
  ];
  if (!items.length) return null;
  return (
    <section aria-label="Needs attention" className="card mb-6 divide-y divide-line-2">
      <div className="px-4 h-10 flex items-center gap-2">
        <span className="text-[13px] font-semibold">Needs attention</span>
        <span className="num text-[12px] text-fg-3">{items.length}</span>
      </div>
      {items.slice(0, 6).map((it) => {
        const row = (
          <>
            <Badge tone={it.tone}>{it.label}</Badge>
            <span className="text-[13px] min-w-0 truncate" title={it.body}>
              {it.body}
            </span>
            {it.href && <span className="ml-auto text-fg-3 shrink-0">→</span>}
          </>
        );
        return it.href ? (
          <Link key={it.key} href={it.href} className="px-4 py-2 flex items-center gap-3 row-link">
            {row}
          </Link>
        ) : (
          <div key={it.key} className="px-4 py-2 flex items-center gap-3">
            {row}
          </div>
        );
      })}
      {items.length > 6 && <div className="px-4 py-2 text-[12px] text-fg-3">+{items.length - 6} more in the sections below</div>}
    </section>
  );
}

/**
 * Channels this product has not connected, each with the commands that connect it. Open while nothing is connected
 * (a new product); afterwards one collapsed line, since leaving a channel out is a fine choice.
 */
function Setup({ channels, slug }: { channels: ChannelSetup[]; slug: string }) {
  const off = channels.filter((c) => !c.connected);
  if (!off.length) return null;
  const none = off.length === channels.length;
  return (
    <section aria-label="Not set up" className="mb-6">
      <details className="card group" open={none}>
        <summary className="select-none px-4 h-10 flex items-center gap-2 text-[13px]">
          <span className="font-semibold">{none ? "Connect your first channel" : "Not set up"}</span>
          <span className="text-fg-3 truncate min-w-0">{off.map((c) => c.label).join(" · ")}</span>
          <span className="ml-auto text-fg-3 shrink-0 transition-transform duration-200 group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true">
            ›
          </span>
        </summary>
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-px bg-line-2 border-t border-line-2">
          {off.map((c) => (
            <div key={c.key} className="bg-bg-2 p-4 min-w-0 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold">{c.label}</span>
                {c.path && (
                  <Link href={`/p/${slug}${c.path}`} className="ml-auto text-[12px] text-fg-2 hover:text-fg">
                    Open →
                  </Link>
                )}
              </div>
              <p className="text-[13px] text-fg-2">{c.gives}</p>
              <ol className="flex flex-col gap-1">
                {c.steps.map((s) => (
                  <li key={s} className={s.startsWith("pnpm ") ? "num text-[11px] text-fg-2 bg-bg border border-line rounded-[3px] px-2 py-1 [overflow-wrap:anywhere]" : "text-[12px] text-fg-3"}>
                    {s}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
        <p className="px-4 py-2 border-t border-line-2 text-[12px] text-fg-3">
          Each channel needs its key on the machine that runs the commands.{" "}
          <Link href="/setup" className="underline">
            Setup
          </Link>{" "}
          lists them; <code className="num">pnpm doctor</code> checks them.
        </p>
      </details>
    </section>
  );
}

/** The last few complete weeks: proceeds and paying users against the week before, and spend vs proceeds per week. */
function Trend({ o }: { o: Overview }) {
  const weeks = o.trend;
  if (!weeks.length) return null;
  const c = o.scorecard.currency;
  const last = weeks[weeks.length - 1]!;
  const prev = weeks[weeks.length - 2];
  const trials = weeks.reduce((a, w) => a + w.trials, 0);
  const paid = weeks.reduce((a, w) => a + w.paid, 0);
  return (
    <section aria-label="Weekly trend" className="mb-6">
      <SectionHead
        right={
          <span className="text-[13px] text-fg-3">
            {fmtDate(weeks[0]!.from)} – {fmtDate(last.to)}
          </span>
        }
      >
        Last {weeks.length} weeks
      </SectionHead>
      <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
        <div className="grid grid-cols-3 xl:grid-cols-1 gap-3">
          <Stat label="Proceeds, last 7 days" value={fmtMoney(last.proceeds, c)} hint={prev ? `${fmtMoney(prev.proceeds, c)} the week before` : undefined} />
          <Stat label="Paying users, last 7 days" value={fmtInt(last.paid)} hint={prev ? `${fmtInt(prev.paid)} the week before` : undefined} />
          <Stat label="Trial to paid" value={trials ? `${Math.round((paid / trials) * 100)}%` : "–"} hint={`${fmtInt(paid)} paid of ${fmtInt(trials)} trials in ${weeks.length} weeks`} />
        </div>
        <Card className="px-4 py-3.5 min-w-0">
          <TrendChart weeks={weeks} channelLabels={Object.fromEntries(o.channels.map((channel) => [channel.key, channel.label]))} />
        </Card>
      </div>
    </section>
  );
}

function Window({ o, slug }: { o: Overview; slug: string }) {
  const c = o.scorecard.currency;
  const total = o.channels.find((r) => r.key === "total")!;
  const rows = o.channels.filter((r) => r.key !== "total");
  return (
    <section aria-label="Channels" className="mb-6">
      <SectionHead
        right={
          <span className="text-[13px] text-fg-3">
            {fmtDate(o.window.from)} – {fmtDate(o.window.to)}
          </span>
        }
      >
        Channels, last {o.window.days} days
      </SectionHead>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-3">
        <Stat label="Ad spend" value={fmtMoney(total.spend, c)} />
        <Stat label="Trials" value={fmtInt(total.trials)} hint="RevenueCat, all sources" />
        <Stat label="Cost per trial" value={fmtMoney(total.costPerTrial, c, true)} hint="all spend ÷ all trials" />
        <Stat label="Proceeds" value={fmtMoney(total.proceeds, c)} hint={`${fmtInt(total.paid)} trial(s) converted`} />
        <Stat label="Proceeds per trial" value={fmtMoney(o.proceedsPerTrial, c, true)} hint="cost per trial must get below this" />
      </div>
      <DataTable
        dense
        className="mb-1"
        columns={[
          { label: "Channel" },
          { label: "Attribution", sortable: false },
          { label: "Spend", align: "right" },
          { label: "Installs", align: "right" },
          { label: "Trials", align: "right" },
          { label: "Paid", align: "right", title: "Trial conversions (RevenueCat)" },
          { label: "Proceeds", align: "right" },
          { label: "Cost per trial", align: "right", firstDir: "asc" },
        ]}
        rows={rows.map((r) => ({
          id: r.key,
          href: r.path ? `/p/${slug}${r.path}?days=${o.window.days}` : undefined,
          cells: [
            {
              node: (
                <span className="font-medium">
                  {r.label}
                  {r.path && <span className="text-fg-3 ml-1">→</span>}
                </span>
              ),
              value: r.label,
            },
            { node: r.attribution, dim: true },
            { node: fmtMoney(r.spend, c), value: r.spend },
            { node: fmtInt(r.installs), value: r.installs },
            { node: fmtInt(r.trials), value: r.trials },
            { node: fmtInt(r.paid), value: r.paid },
            { node: fmtMoney(r.proceeds, c), value: r.proceeds },
            { node: fmtMoney(r.costPerTrial, c, true), value: r.costPerTrial },
          ],
        }))}
      />
      <p className="text-xs text-fg-3">Meta reports its own trials (AppsFlyer); RevenueCat does not attribute them, so they also sit in “Not attributed”.</p>
    </section>
  );
}

function MetaAds({ o, slug }: { o: Overview; slug: string }) {
  const c = o.scorecard.currency;
  return (
    <section aria-label="Meta ads" className="mb-6 min-w-0">
      <SectionHead
        right={
          <Link href={`/p/${slug}/meta-ads?days=${o.window.days}`} className="text-[13px] text-fg-2 hover:text-fg">
            Meta ads →
          </Link>
        }
      >
        Meta ads by spend
      </SectionHead>
      {o.ads.length === 0 ? (
        <Empty>No Meta spend in this window.</Empty>
      ) : (
        <DataTable
          dense
          className=""
          maxHeight="420px"
          defaultSort={{ col: 2, dir: "desc" }}
          columns={[{ label: "Ad" }, { label: "Status" }, { label: "Spend", align: "right" }, { label: "Trials", align: "right" }, { label: "Cost per trial", align: "right", firstDir: "asc" }]}
          rows={o.ads.map((a) => ({
            id: a.id,
            href: `/p/${slug}/meta-ads?days=${o.window.days}`,
            cells: [
              {
                node: (
                  <span className="block max-w-[280px] truncate" title={a.name}>
                    {a.name}
                  </span>
                ),
                value: a.name,
              },
              { node: <StatusDot tone={a.status === "ACTIVE" ? "green" : "neutral"}>{a.status.toLowerCase()}</StatusDot>, value: a.status },
              { node: fmtMoney(a.spend, c, true), value: a.spend },
              { node: fmtInt(a.trials), value: a.trials },
              { node: fmtMoney(a.costPerTrial, c, true), value: a.costPerTrial },
            ],
          }))}
        />
      )}
    </section>
  );
}

function Organic({ o, slug }: { o: Overview; slug: string }) {
  const { organic } = o;
  return (
    <section aria-label="Own posts" className="mb-6 min-w-0">
      <SectionHead
        right={
          <Link href={`/p/${slug}/my-accounts`} className="text-[13px] text-fg-2 hover:text-fg">
            My accounts →
          </Link>
        }
      >
        Own posts, last {o.window.days} days
      </SectionHead>
      {organic.accounts === 0 ? (
        <Empty>
          No own accounts tracked. Add them on{" "}
          <Link className="underline" href={`/p/${slug}/my-accounts`}>
            My accounts
          </Link>
          .
        </Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <Stat label="Posts" value={fmtInt(organic.posts.length)} hint={`across ${organic.accounts} account(s)`} />
            <Stat label="Views" value={fmtInt(organic.views)} hint="latest count for those posts" />
          </div>
          <DataTable
            dense
            className=""
            maxHeight="300px"
            empty="Nothing posted in this window."
            columns={[{ label: "Account" }, { label: "Posted" }, { label: "Views", align: "right" }]}
            rows={organic.posts.map((p, i) => ({
              id: `${p.platform}-${p.handle}-${i}`,
              href: p.url ?? undefined,
              cells: [
                {
                  node: (
                    <span>
                      @{p.handle} <span className="text-fg-3">{p.platform}</span>
                    </span>
                  ),
                  value: p.handle,
                },
                { node: fmtDate(p.postedAt), value: p.postedAt, dim: true },
                { node: fmtInt(p.views), value: p.views },
              ],
            }))}
          />
        </>
      )}
    </section>
  );
}

function Experiments({ o, slug }: { o: Overview; slug: string }) {
  const running = o.scorecard.running;
  const path = (channel: string) => (channel === "apple_ads" ? "apple-ads" : channel === "meta_ads" ? "meta-ads" : null);
  return (
    <section aria-label="Running experiments" className="mb-6 min-w-0">
      <SectionHead>Running experiments</SectionHead>
      <DataTable
        dense
        className=""
        empty="No experiment is running."
        columns={[{ label: "Experiment" }, { label: "Channel" }]}
        rows={running.map((e) => ({
          id: e.slug,
          href: path(e.channel) ? `/p/${slug}/${path(e.channel)}` : undefined,
          cells: [
            {
              node: (
                <span className="block max-w-[420px] truncate" title={e.slug}>
                  {e.name}
                </span>
              ),
              value: e.name,
            },
            { node: e.channel.replace("_", " "), dim: true },
          ],
        }))}
      />
    </section>
  );
}

function Freshness({ o }: { o: Overview }) {
  const stale = o.freshness.filter((f) => f.stale).length;
  return (
    <section aria-label="Data freshness" className="mb-6 min-w-0">
      <SectionHead right={stale ? <Badge tone="warn">{stale} stale</Badge> : o.freshness.length ? <Badge tone="green">all fresh</Badge> : <Badge>no syncs yet</Badge>}>Data freshness</SectionHead>
      <DataTable
        dense
        className={o.warnings.length ? "mb-3" : ""}
        maxHeight="300px"
        defaultSort={{ col: 1, dir: "desc" }}
        empty="No syncs yet. Every scrape and sync records its runs here."
        columns={[{ label: "Source" }, { label: "Last successful sync", align: "right" }, { label: "Latest run" }]}
        rows={o.freshness.map((f) => ({
          id: f.source,
          cells: [
            { node: f.source.replace("_", " "), value: f.source },
            { node: <span className={f.stale ? "text-warn" : ""}>{fmtAgo(f.lastDone)}</span>, value: f.lastDone },
            { node: <StatusDot tone={f.lastStatus === "done" ? "green" : f.lastStatus === "running" ? "neutral" : "red"}>{f.lastStatus}</StatusDot>, value: f.lastStatus },
          ],
        }))}
      />
      {o.warnings.length > 0 && (
        <ul className="text-[13px] text-fg-2 flex flex-col gap-1">
          {o.warnings.map((w) => (
            <li key={w}>– {w}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AgentBrief({ brief, slug }: { brief: string; slug: string }) {
  return (
    <section aria-label="Brief for agents">
      <details className="card group">
        <summary className="select-none px-4 py-3 text-[14px] font-semibold flex items-center justify-between gap-3">
          Brief for agents
          <span className="text-xs font-normal text-fg-3">
            the same text as <code className="num">pnpm brief --product {slug}</code>
          </span>
        </summary>
        <pre className="num text-xs leading-relaxed whitespace-pre-wrap px-4 pb-4 text-fg-2">{brief}</pre>
      </details>
    </section>
  );
}
