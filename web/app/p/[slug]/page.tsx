import Link from "next/link";
import { notFound } from "next/navigation";
import { getProductBySlug, getTrackedSources } from "@/lib/queries";
import { channelSetup, type ChannelSetup } from "@/lib/setup";
import { DEFAULT_WINDOW_DAYS, formatBrief, overviewFor, type Overview } from "@/lib/overview";
import { fmtAgo, fmtDate, fmtDateTime, fmtInt, fmtMoney } from "@/lib/format";
import { Shell } from "@/components/shell";
import { TrendChart } from "@/components/trend-chart";
import { DataTable } from "@/components/data-table";
import { Badge, Card, Empty, Meter, SectionHead, Segmented, Stat, StatusDot } from "@/components/ui";

export const dynamic = "force-dynamic";

const WINDOWS = [7, 14, 28];

export default async function ProductOverview({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ days?: string; present?: string }> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const product = await getProductBySlug(slug);
  if (!product) notFound();
  const days = WINDOWS.includes(Number(sp.days)) ? Number(sp.days) : DEFAULT_WINDOW_DAYS;
  const [o, sources] = await Promise.all([overviewFor(product, { days }), getTrackedSources(product.id)]);
  const channels = channelSetup(slug, sources);
  // Presenter mode: the trend and channel numbers only, without the goal, internal notes and agent sections.
  const present = sp.present === "1";
  const href = (d: number, p: boolean) => `/p/${slug}?days=${d}${p ? "&present=1" : ""}`;

  const action = (
    <div className="flex items-center gap-2">
      <Segmented label="Window" active={String(days)} items={WINDOWS.map((d) => ({ key: String(d), label: `${d}D`, href: href(d, present) }))} />
      <Link href={href(days, !present)} className="btn" title="Show only the trend and channel numbers, for a demo">
        {present ? "Exit presenting" : "Present"}
      </Link>
    </div>
  );
  const subtitle = `Numbers through ${fmtDate(o.window.to)} · refreshed ${fmtDateTime(o.generatedAt)}`;

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
      <AgentBrief o={o} />
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
            className="ml-auto text-[12px] text-fg-3 cursor-help underline decoration-dotted underline-offset-2"
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
        <summary className="cursor-pointer select-none px-4 h-10 flex items-center gap-2 text-[13px]">
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

function AgentBrief({ o }: { o: Overview }) {
  return (
    <section aria-label="Brief for agents">
      <details className="card group">
        <summary className="cursor-pointer select-none px-4 py-3 text-[14px] font-semibold flex items-center justify-between gap-3">
          Brief for agents
          <span className="text-xs font-normal text-fg-3">
            the same text as <code className="num">pnpm brief --product {o.product}</code>
          </span>
        </summary>
        <pre className="num text-xs leading-relaxed whitespace-pre-wrap px-4 pb-4 text-fg-2">{formatBrief(o)}</pre>
      </details>
    </section>
  );
}
