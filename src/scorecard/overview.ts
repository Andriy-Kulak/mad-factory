/**
 * The product overview: the profit goal, then a short window (default 7 days) per channel, top Meta ads,
 * own posts and data freshness. Pure. The web overview renders it and `pnpm brief` prints it for agents,
 * so humans and LLMs read the same numbers.
 */
import type { ScorecardData, WindowData } from "../db/scorecard.ts";
import { addDays, type Scorecard } from "./scorecard.ts";
import { discoveryGaps, formatDiscoveryGaps } from "../apple-ads/coverage.ts";

/** Attribution older than this is not trusted (Meta via AppsFlyer and RevenueCat both settle within days). */
export const DEFAULT_WINDOW_DAYS = 7;
/** Complete 7-day weeks in the overview's trend, newest last. */
export const TREND_WEEKS = 4;
/** A source whose last successful run is older than this is stale. */
const STALE_HOURS = 36;

export interface ChannelRow {
  key: "meta_ads" | "apple_ads" | "unattributed" | "total";
  label: string;
  attribution: string;
  /** Path under /p/<slug> with the details. */
  path: string | null;
  spend: number | null;
  installs: number | null;
  trials: number;
  paid: number | null;
  proceeds: number | null;
  costPerTrial: number | null;
}

export interface AdLine {
  id: string;
  name: string;
  status: string;
  spend: number;
  installs: number;
  trials: number;
  costPerTrial: number | null;
}

export interface PostLine {
  platform: string;
  handle: string;
  url: string | null;
  postedAt: string;
  views: number | null;
}

export interface SourceFreshness {
  source: string;
  lastDone: string | null;
  lastStatus: string;
  stale: boolean;
}

/** An open promise to come back to something (experiment_log row with due_on, unresolved). */
export interface FollowUp {
  id: string;
  /** "<channel>/<slug>" of the experiment it belongs to. */
  experiment: string;
  dueOn: string;
  body: string;
  /** Today (UTC) minus dueOn in days: positive is overdue, 0 due today, negative upcoming. */
  daysOverdue: number;
}

/** One 7-day block of the trend: all ad spend against RevenueCat proceeds, trials and trial conversions. */
export interface WeekLine {
  from: string;
  to: string;
  spend: number;
  spendByChannel: Record<string, number>;
  proceeds: number;
  profit: number;
  trials: number;
  paid: number;
}

export interface Overview {
  product: string;
  generatedAt: string;
  window: { from: string; to: string; days: number };
  scorecard: Scorecard;
  /** Whether the month projects to a profit (above zero), or no goal is set. */
  status: "profitable" | "not_profitable" | "no_goal";
  channels: ChannelRow[];
  /** Window profit before fixed costs: RevenueCat proceeds − ad spend. */
  windowProfit: number;
  /** RevenueCat proceeds per RevenueCat trial in the window: a first-payment ceiling for cost per trial. */
  proceedsPerTrial: number | null;
  /** The last TREND_WEEKS 7-day blocks ending on window.to, oldest first; independent of the window length. */
  trend: WeekLine[];
  ads: AdLine[];
  organic: { accounts: number; posts: PostLine[]; views: number };
  freshness: SourceFreshness[];
  warnings: string[];
  followUps: FollowUp[];
}

const round = (n: number) => Math.round(n * 100) / 100;
const per = (a: number | null, b: number) => (a != null && b > 0 ? round(a / b) : null);

/** Buckets daily rows into `weeks` 7-day blocks ending on `through`, oldest first. Rows in other currencies are left out. */
export function weeklyTrend(data: ScorecardData, currency: string, through: string, weeks = TREND_WEEKS): WeekLine[] {
  const channels = Object.entries(data.spend);
  const spend = channels.flatMap(([, rows]) => rows);
  return Array.from({ length: weeks }, (_, i) => {
    const to = addDays(through, -7 * (weeks - 1 - i));
    const from = addDays(to, -6);
    const inWeek = (r: { date: string }) => r.date >= from && r.date <= to;
    const money = (rows: { date: string; amount: number; currency: string }[]) => round(rows.filter((r) => inWeek(r) && r.currency === currency).reduce((a, r) => a + r.amount, 0));
    const t = data.trials.filter(inWeek);
    const spendByChannel = Object.fromEntries(channels.map(([channel, rows]) => [channel, money(rows)]));
    const w = { spend: money(spend), proceeds: money(data.proceeds) };
    return { from, to, ...w, spendByChannel, profit: round(w.proceeds - w.spend), trials: t.reduce((a, r) => a + r.n, 0), paid: t.reduce((a, r) => a + r.paid, 0) };
  });
}

export function buildOverview(input: {
  product: string;
  window: { from: string; to: string; days: number };
  scorecard: Scorecard;
  data: WindowData;
  /** Daily rows covering the trend weeks (see weeklyTrend); no trend when absent. */
  trendData?: ScorecardData;
  now?: Date;
}): Overview {
  const { scorecard: sc, data } = input;
  const now = input.now ?? new Date();
  const cur = sc.currency;
  const warnings: string[] = formatDiscoveryGaps(data.appleCoverage.campaigns, discoveryGaps(data.appleCoverage.campaigns, data.appleCoverage.keywords));
  const keep = <T extends { currency: string }>(rows: T[], label: string) => {
    const ok = rows.filter((r) => r.currency === cur);
    if (ok.length < rows.length) warnings.push(`${label}: ${rows.length - ok.length} row(s) not in ${cur} left out`);
    return ok;
  };

  const meta = keep(data.meta, "Meta");
  const apple = keep(data.apple, "Apple Ads");
  const rc = keep(data.revenuecat, "RevenueCat");
  const sum = <T>(rows: T[], f: (r: T) => number) => round(rows.reduce((a, r) => a + f(r), 0));

  const metaSpend = sum(meta, (r) => r.spend);
  const metaTrials = sum(meta, (r) => r.trials);
  const appleSpend = sum(apple, (r) => r.spend);
  const rcApple = rc.filter((r) => r.campaign !== "");
  const rcNone = rc.filter((r) => r.campaign === "");
  const appleTrials = sum(rcApple, (r) => r.trials);
  const noneTrials = sum(rcNone, (r) => r.trials);
  const totalSpend = round(metaSpend + appleSpend);
  const totalTrials = sum(rc, (r) => r.trials);
  const totalProceeds = sum(rc, (r) => r.proceeds);

  const channels: ChannelRow[] = [
    {
      key: "meta_ads",
      label: "Meta ads",
      attribution: "Meta-reported (AppsFlyer)",
      path: "/meta-ads",
      spend: metaSpend,
      installs: sum(meta, (r) => r.installs),
      trials: metaTrials,
      paid: null,
      proceeds: null,
      costPerTrial: per(metaSpend, metaTrials),
    },
    {
      key: "apple_ads",
      label: "Apple ads",
      attribution: "RevenueCat (Apple AdServices)",
      path: "/apple-ads",
      spend: appleSpend,
      installs: sum(apple, (r) => r.installs),
      trials: appleTrials,
      paid: sum(rcApple, (r) => r.paid),
      proceeds: sum(rcApple, (r) => r.proceeds),
      costPerTrial: per(appleSpend, appleTrials),
    },
    {
      key: "unattributed",
      label: "Not attributed",
      attribution: "RevenueCat, no campaign: organic, Meta and anything else",
      path: null,
      spend: null,
      installs: null,
      trials: noneTrials,
      paid: sum(rcNone, (r) => r.paid),
      proceeds: sum(rcNone, (r) => r.proceeds),
      costPerTrial: null,
    },
    {
      key: "total",
      label: "Total",
      attribution: "Spend from both channels; trials, paid and proceeds from RevenueCat",
      path: null,
      spend: totalSpend,
      installs: null,
      trials: totalTrials,
      paid: sum(rc, (r) => r.paid),
      proceeds: totalProceeds,
      costPerTrial: per(totalSpend, totalTrials),
    },
  ];

  const names = new Map(data.metaAds.map((a) => [a.id, a]));
  const byAd = new Map<string, AdLine>();
  for (const r of meta) {
    const a = names.get(r.ad_id);
    const line = byAd.get(r.ad_id) ?? { id: r.ad_id, name: a?.name ?? r.ad_id, status: a?.status ?? "", spend: 0, installs: 0, trials: 0, costPerTrial: null };
    line.spend += r.spend;
    line.installs += r.installs;
    line.trials += r.trials;
    byAd.set(r.ad_id, line);
  }
  const ads = [...byAd.values()]
    .map((l) => ({ ...l, spend: round(l.spend), costPerTrial: per(l.spend, l.trials) }))
    .filter((l) => l.spend > 0 || l.trials > 0)
    .sort((a, b) => b.spend - a.spend);

  const posts = data.ownPosts.map((p) => ({ platform: p.platform, handle: p.handle, url: p.url, postedAt: p.posted_at, views: p.views })).sort((a, b) => (b.views ?? -1) - (a.views ?? -1));

  const bySource = new Map<string, SourceFreshness>();
  for (const r of data.runs) {
    const f = bySource.get(r.source) ?? { source: r.source, lastDone: null, lastStatus: r.status, stale: true };
    if (!f.lastDone && r.status === "done" && r.finished_at) f.lastDone = r.finished_at;
    bySource.set(r.source, f);
  }
  const freshness = [...bySource.values()]
    .map((f) => ({ ...f, stale: !f.lastDone || now.getTime() - Date.parse(f.lastDone) > STALE_HOURS * 3_600_000 }))
    .sort((a, b) => a.source.localeCompare(b.source));

  const today = now.toISOString().slice(0, 10);
  const followUps: FollowUp[] = data.followUps
    .map((f) => ({ id: f.id, experiment: f.experiment, dueOn: f.due_on, body: f.body, daysOverdue: Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${f.due_on}T00:00:00Z`)) / 86_400_000) }))
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));

  const projected = sc.projected?.profit ?? sc.sevenDayPace.profit;
  return {
    product: input.product,
    generatedAt: now.toISOString(),
    window: input.window,
    scorecard: sc,
    status: !sc.goal ? "no_goal" : projected > 0 ? "profitable" : "not_profitable",
    channels,
    windowProfit: round(totalProceeds - totalSpend),
    proceedsPerTrial: per(totalProceeds, totalTrials),
    trend: input.trendData ? weeklyTrend(input.trendData, cur, input.window.to) : [],
    ads,
    organic: { accounts: data.ownAccounts, posts, views: posts.reduce((a, p) => a + (p.views ?? 0), 0) },
    freshness,
    warnings: [...sc.warnings, ...warnings],
    followUps,
  };
}

const money = (n: number | null | undefined) => (n == null ? "—" : (n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const whole = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"));

/** Markdown status for agents: the goal first, then what the last days say, then what is stale. */
export function formatBrief(o: Overview): string {
  const sc = o.scorecard;
  const c = sc.currency;
  const goal = sc.goal
    ? `**Goal: ${money(sc.goal.target)} ${c} profit per month** (profit = RevenueCat proceeds − ad spend − fixed costs).`
    : "**Goal: not set** (`pnpm scorecard goal --product <slug> --target <amount>`).";
  const projected = sc.projected?.profit ?? sc.sevenDayPace.profit;
  const state = o.status === "profitable" ? "PROFITABLE" : o.status === "not_profitable" ? "NOT PROFITABLE YET" : "NO GOAL";
  const lines = [
    `# ${o.product}: status ${o.generatedAt.slice(0, 10)}`,
    "",
    goal,
    `Now: **${state}**. This month projects to ${money(projected)} ${c}${sc.gap != null ? ` (gap to goal ${money(sc.gap)})` : ""}; month to date ${money(sc.monthToDate.profit)}.`,
    `Decide on the last ${o.window.days} days (${o.window.from} to ${o.window.to}); attribution older than about 10 days is not reliable.`,
    "",
    `## Last ${o.window.days} days`,
    `Profit before fixed costs ${money(o.windowProfit)} ${c}. Proceeds per trial ${money(o.proceedsPerTrial)}: a channel whose cost per trial is above this loses money on first payments.`,
    "",
    "| Channel | Attribution | Spend | Installs | Trials | Paid | Proceeds | Cost per trial |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...o.channels.map((r) => `| ${r.label} | ${r.attribution} | ${money(r.spend)} | ${whole(r.installs)} | ${whole(r.trials)} | ${whole(r.paid)} | ${money(r.proceeds)} | ${money(r.costPerTrial)} |`),
    "",
    "Meta's trials also appear in RevenueCat's \"Not attributed\" row, so channel trials do not add up to the total.",
  ];
  if (o.trend.length) {
    const spendChannels = Object.keys(o.trend[0]!.spendByChannel);
    const columns = ["Week", "Spend", ...spendChannels, "Proceeds", "Profit", "Trials", "Paid"];
    lines.push("", "## Weekly trend", `| ${columns.join(" | ")} |`, `| ${columns.map((_, i) => (i ? "---:" : "---")).join(" | ")} |`);
    for (const w of o.trend) {
      const channelSpend = spendChannels.map((channel) => money(w.spendByChannel[channel] ?? 0));
      lines.push(`| ${[`${w.from} to ${w.to}`, money(w.spend), ...channelSpend, money(w.proceeds), money(w.profit), whole(w.trials), whole(w.paid)].join(" | ")} |`);
    }
  }
  if (o.ads.length) {
    lines.push("", "## Meta ads by spend", "| Ad | Status | Spend | Trials | Cost per trial |", "| --- | --- | ---: | ---: | ---: |");
    for (const a of o.ads.slice(0, 10)) lines.push(`| ${a.name} | ${a.status} | ${money(a.spend)} | ${whole(a.trials)} | ${money(a.costPerTrial)} |`);
  }
  lines.push("", "## Own short-form posts", `${o.organic.posts.length} posted in the window across ${o.organic.accounts} account(s), ${whole(o.organic.views)} views so far.`);
  for (const p of o.organic.posts.slice(0, 5)) lines.push(`- ${p.platform} @${p.handle} ${p.postedAt.slice(0, 10)}: ${whole(p.views)} views ${p.url ?? ""}`.trimEnd());
  if (sc.running.length) lines.push("", "## Running experiments", ...sc.running.map((e) => `- ${e.channel}/${e.slug}: ${e.name}`));
  const due = o.followUps.filter((f) => f.daysOverdue >= 0);
  const upcoming = o.followUps.filter((f) => f.daysOverdue < 0);
  if (due.length || upcoming.length) {
    lines.push("", "## Follow-ups due");
    for (const f of due) {
      const when = f.daysOverdue > 0 ? `${f.daysOverdue} day${f.daysOverdue === 1 ? "" : "s"} overdue` : "due today";
      lines.push(`- ${f.dueOn} (${when}) ${f.experiment}: ${f.body} — \`pnpm experiment resolve --product ${o.product} --id ${f.id} "<what was done>"\``);
    }
    if (upcoming.length) lines.push(`Upcoming: ${upcoming.length} (next ${upcoming[0]!.dueOn} ${upcoming[0]!.experiment})`);
  }
  const stale = o.freshness.filter((f) => f.stale);
  if (stale.length || o.warnings.length) {
    lines.push("", "## Check before trusting the numbers");
    for (const f of stale) lines.push(`- ${f.source}: last successful sync ${f.lastDone ?? "never"} (latest run ${f.lastStatus})`);
    for (const w of o.warnings) lines.push(`- ${w}`);
  }
  lines.push(
    "",
    "## How to act",
    "Double down on what gets trials below the proceeds-per-trial line; cut what spends without trials. Changes to an ad account go through an owner-approved plan document in product_docs. Read it with `pnpm product docs show <product> <plan-name>`. Code changes go through a PR with the Goal check (`pnpm ready`).",
  );
  return lines.join("\n");
}
