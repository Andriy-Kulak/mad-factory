import Link from "next/link";
import { Card, Empty, SectionHead, Segmented, Stat } from "./ui";
import { SpendChart, type DayPoint } from "./spend-chart";
import { MetaName, int, metaMetrics, moneyFmt, pct, type MetaRange } from "./meta-ads";
import { DataTable } from "./data-table";
import { attributeKeys, groupByAttributes, UNTAGGED, type Attributes, type MetaAdsRollup } from "@/lib/meta-ads-rollup";
import { fmtDateTime } from "@/lib/format";
import type { ScrapeRunRow } from "@db/types";

export function NotSynced({ slug, missingTables }: { slug: string; missingTables: boolean }) {
  return (
    <Empty>
      {missingTables ? "The meta_ads tables are not in this database yet: apply the Meta Ads migration first. " : "No Meta Ads campaigns synced for this product. "}
      Track the ad account with <code className="num">pnpm product add-source {slug} --source meta_ads --kind ad_account --value act_…</code>, then run{" "}
      <code className="num">pnpm meta-ads sync --product {slug} --days 28</code>.
    </Empty>
  );
}

export function SyncNote({ run }: { run: ScrapeRunRow | null }) {
  if (!run) return null;
  return (
    <p
      className={`text-xs mb-6 ${run.status === "error" ? "text-danger" : "text-fg-3"}`}
      title="Trials and purchases are Meta-reported (attributed by Meta, not RevenueCat). Recent days move as Meta and SKAdNetwork report late conversions; each sync re-pulls them."
    >
      Synced {fmtDateTime(run.finished_at ?? run.started_at)}
      {run.status === "error" ? ` with an error${run.error ? `: ${run.error}` : ""}` : ""} · trials and purchases are Meta-attributed; the last few days still fill in.
    </p>
  );
}

/** Creative attributes as small key:value chips; past `max`, the rest collapse into "+n" (all of them in the tooltip). */
export function AttributeChips({ a, max = 3 }: { a: Attributes; max?: number }) {
  const entries = Object.entries(a);
  if (!entries.length)
    return (
      <span className="text-fg-3 text-[12px]" title="Tag with pnpm meta-ads tag <creative_id> angle=… hook=…">
        untagged
      </span>
    );
  const chip = "num text-[10.5px] px-1 h-[18px] inline-flex items-center rounded-[2px] border border-line bg-bg-3 text-fg-2";
  return (
    <span className="inline-flex flex-wrap gap-0.5 max-w-[200px]" title={entries.map(([k, v]) => `${k}: ${v}`).join("\n")}>
      {entries.slice(0, max).map(([k, v]) => (
        <span key={k} className={chip}>
          <span className="text-fg-3">{k}:</span>
          {String(v)}
        </span>
      ))}
      {entries.length > max && <span className={chip}>+{entries.length - max}</span>}
    </span>
  );
}

export function MetaAdsOverviewBody({ o, slug, range }: { o: MetaAdsRollup & { since: string; until: string; lastRun: ScrapeRunRow | null }; slug: string; range: MetaRange }) {
  const { money, per } = moneyFmt(o.currency);
  const cur = o.currency;
  const byDate = new Map(o.days.map((d) => [d.date, d]));
  const series: DayPoint[] = [];
  for (let d = new Date(`${o.since}T12:00:00Z`); d.toISOString().slice(0, 10) <= o.until; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    const t = byDate.get(date);
    series.push({ date, spend: t?.spend ?? 0, impressions: t?.impressions ?? 0, taps: t?.clicks ?? 0, installs: t?.installs ?? 0, trials: t?.trials ?? 0 });
  }
  const live = o.ads.filter((a) => a.status === "ACTIVE").length;
  const untagged = o.ads.filter((a) => a.totals.spend > 0 && !Object.keys(a.attributes).length).length;
  const campaignM = metaMetrics(
    o.campaigns.map((c) => c.totals),
    cur,
  );
  const adsetM = metaMetrics(
    o.adsets.map((a) => a.totals),
    cur,
  );
  const adM = metaMetrics(
    o.ads.map((a) => a.totals),
    cur,
  );
  const countryM = metaMetrics(o.countries, cur);
  const dailyBudget =
    o.campaigns.filter((c) => c.effective_status === "ACTIVE").reduce((s, c) => s + Number(c.daily_budget ?? 0), 0) +
    o.adsets.filter((a) => a.effective_status === "ACTIVE").reduce((s, a) => s + Number(a.daily_budget ?? 0), 0);

  return (
    <>
      <SectionHead>All campaigns · {range.label}</SectionHead>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-3">
        <Stat label="Spend" value={money(o.totals.spend)} hint={`active daily budgets ${money(dailyBudget / 100)}`} />
        <Stat label="Impressions" value={int(o.totals.impressions)} />
        <Stat label="Clicks" value={int(o.totals.clicks)} hint={`CTR ${pct(o.totals.clicks, o.totals.impressions)}`} />
        <Stat label="Installs" value={int(o.totals.installs)} hint={`${per(o.totals.spend, o.totals.installs)} per install`} />
        <Stat label="Trials" value={int(o.totals.trials)} hint={`${per(o.totals.spend, o.totals.trials)} per trial`} />
        <Stat label="Ads" value={o.ads.length} hint={`${live} active · ${untagged} with spend untagged`} />
      </div>
      <SyncNote run={o.lastRun} />

      <SectionHead>Campaigns</SectionHead>
      <DataTable
        dense
        stickyFirst
        columns={[{ label: "Campaign" }, { label: "Budget / day", align: "right" }, { label: "Ad sets · ads", align: "right" }, ...campaignM.columns]}
        defaultSort={{ col: 3, dir: "desc" }}
        rows={o.campaigns.map((c) => {
          const status = c.effective_status ?? c.status;
          return {
            id: c.id,
            cells: [
              {
                node: (
                  <MetaName
                    name={c.name}
                    id={c.id}
                    status={status}
                    sub={c.objective
                      ?.replace(/^OUTCOME_/, "")
                      .toLowerCase()
                      .replace(/_/g, " ")}
                  />
                ),
                value: c.name,
              },
              { node: c.daily_budget == null ? "per ad set" : money(Number(c.daily_budget) / 100), value: c.daily_budget == null ? null : Number(c.daily_budget), dim: c.daily_budget == null },
              { node: `${c.adsets} · ${c.ads}`, value: c.ads },
              ...campaignM.cells(c.totals),
            ],
          };
        })}
      />

      <SectionHead>Ad sets</SectionHead>
      <DataTable
        dense
        stickyFirst
        columns={[{ label: "Ad set" }, { label: "Budget / day", align: "right" }, ...adsetM.columns]}
        defaultSort={{ col: 2, dir: "desc" }}
        rows={o.adsets.map((a) => {
          const learning = a.learning_stage_info && typeof a.learning_stage_info === "object" && !Array.isArray(a.learning_stage_info) ? String(a.learning_stage_info.status ?? "") : "";
          const status = a.effective_status ?? a.status;
          return {
            id: a.id,
            cells: [
              {
                node: (
                  <MetaName
                    name={a.name}
                    id={a.id}
                    status={status}
                    note={learning && learning !== "SUCCESS" ? learning.toLowerCase() : null}
                    sub={[a.campaignName, a.optimization_goal?.toLowerCase().replace(/_/g, " ")].filter(Boolean).join(" · ")}
                  />
                ),
                value: a.name,
              },
              { node: a.daily_budget == null ? "–" : money(Number(a.daily_budget) / 100), value: a.daily_budget == null ? null : Number(a.daily_budget), dim: a.daily_budget == null },
              ...adsetM.cells(a.totals),
            ],
          };
        })}
      />

      <SectionHead
        right={
          <Link href={`/p/${slug}/meta-ads/creatives`} className="text-xs text-fg-2 underline">
            performance by creative attribute →
          </Link>
        }
      >
        Ads
      </SectionHead>
      <DataTable
        dense
        stickyFirst
        searchLabel="Search ads, ad sets, headlines"
        views={[
          { key: "all", label: "All" },
          { key: "active", label: "Active" },
          { key: "spent", label: "With spend" },
          { key: "untagged", label: "Untagged" },
        ]}
        columns={[{ label: "Ad" }, { label: "Attributes", sortable: false }, ...adM.columns]}
        defaultSort={{ col: 2, dir: "desc" }}
        rows={o.ads.map((a) => {
          const headline = a.creative?.title ?? null;
          const tagged = Object.keys(a.attributes).length > 0;
          return {
            id: a.id,
            tags: [a.status === "ACTIVE" ? "active" : "", a.totals.spend > 0 ? "spent" : "", tagged ? "" : "untagged"].filter(Boolean),
            search: [a.name, a.adsetName, a.campaignName, headline, a.creative?.body, ...Object.values(a.attributes).map(String)].filter(Boolean).join(" "),
            cells: [
              {
                node: (
                  <MetaName
                    name={a.name}
                    status={a.status}
                    id={`${a.id}${a.creative ? ` · creative ${a.creative.id}` : ""}\n${a.adsetName} · ${a.campaignName}${a.creative?.body ? `\n\n${a.creative.body}` : ""}`}
                    thumb={a.creative?.thumbnail_url ?? null}
                    sub={
                      <>
                        <span className="text-fg-2">{a.adsetName}</span>
                        {headline ? <> · {headline}</> : null}
                      </>
                    }
                  />
                ),
                value: a.name,
              },
              { node: <AttributeChips a={a.attributes} />, className: "whitespace-normal" },
              ...adM.cells(a.totals),
            ],
          };
        })}
      />
      {adM.hidden.length > 0 && <p className="text-xs text-fg-3 -mt-4 mb-6">No {adM.hidden.join(" or ")} in this range, so those columns are hidden.</p>}

      <div className="grid lg:grid-cols-2 gap-x-3">
        <div className="min-w-0">
          <SectionHead>Spend by day</SectionHead>
          <Card className="p-4 mb-6">
            <SpendChart days={series} tapsLabel="clicks" />
            <details className="mt-2 text-xs">
              <summary className="text-fg-3 cursor-pointer">Table view</summary>
              <table className="num w-full mt-2">
                <tbody>
                  {series.map((d) => (
                    <tr key={d.date} className="border-t border-line">
                      <td className="py-1 text-fg-3">{d.date}</td>
                      <td className="text-right">{money(d.spend)}</td>
                      <td className="text-right text-fg-3">{int(d.impressions)} impr</td>
                      <td className="text-right text-fg-3">{d.taps} clicks</td>
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
          <DataTable
            dense
            columns={[{ label: "Country" }, ...countryM.columns, { label: "Share", align: "right", title: "Share of spend" }]}
            defaultSort={{ col: 1, dir: "desc" }}
            empty="No country rows in range."
            rows={o.countries.map((c) => ({
              id: c.country,
              cells: [
                { node: <span className="font-medium">{c.country}</span>, value: c.country },
                ...countryM.cells(c),
                { node: pct(c.spend, o.totals.spend), value: o.totals.spend ? c.spend / o.totals.spend : null },
              ],
            }))}
          />
        </div>
      </div>
    </>
  );
}

export function MetaCreativesBody({ o, slug, range, by, then }: { o: MetaAdsRollup & { lastRun: ScrapeRunRow | null }; slug: string; range: MetaRange; by: string; then: string | null }) {
  const keys = attributeKeys(o.ads);
  const groups = groupByAttributes(o.ads, then ? [by, then] : [by]);
  const untagged = o.ads.filter((a) => !Object.keys(a.attributes).length && a.creative);
  const groupM = metaMetrics(
    groups.map((g) => g.totals),
    o.currency,
  );
  const base = `/p/${slug}/meta-ads/creatives`;
  const rangeQs: Record<string, string> = range.custom ? { from: range.since, to: range.until } : { days: String(range.days) };
  const href = (p: Record<string, string>) => `${base}?${new URLSearchParams({ ...rangeQs, ...p })}`;

  return (
    <>
      <Card className="p-4 mb-6 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="label w-20">Group by</span>
          <Segmented size="sm" wrap label="Group by" active={by} items={keys.map((k) => ({ key: k, label: k, href: href({ by: k, ...(then && then !== k ? { then } : {}) }) }))} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="label w-20">Then by</span>
          <Segmented
            size="sm"
            wrap
            label="Then by"
            active={then ?? "__none"}
            items={[{ key: "__none", label: "none", href: href({ by }) }, ...keys.filter((k) => k !== by).map((k) => ({ key: k, label: k, href: href({ by, then: k }) }))]}
          />
        </div>
      </Card>
      <SyncNote run={o.lastRun} />

      <SectionHead right={<span className="text-xs text-fg-3">{range.label} · sorted by spend · cost per trial is the current decision metric</span>}>{then ? `${by} × ${then}` : by}</SectionHead>
      <DataTable
        dense
        stickyFirst
        columns={[{ label: by }, ...(then ? [{ label: then }] : []), { label: "Ads", align: "right" as const }, ...groupM.columns]}
        defaultSort={{ col: then ? 3 : 2, dir: "desc" }}
        rows={groups.map((g) => ({
          id: g.values.join("|"),
          cells: [
            ...g.values.map((v) => ({ node: <span className={v === UNTAGGED ? "italic" : "font-semibold"}>{v}</span>, value: v === UNTAGGED ? null : v, dim: v === UNTAGGED })),
            { node: g.ads, value: g.ads },
            ...groupM.cells(g.totals),
          ],
        }))}
      />

      <SectionHead
        right={
          <span className="text-xs text-fg-3">
            tag with <code className="num">pnpm meta-ads tag &lt;creative_id&gt; angle=… hook=… format=… length_s=15 version=v1 avatar=…</code>
          </span>
        }
      >
        Untagged creatives
      </SectionHead>
      {untagged.length === 0 ? (
        <Card className="p-6 mb-6 text-fg-3 text-[13px]">Every synced creative has at least one attribute.</Card>
      ) : (
        <DataTable
          columns={[{ label: "Creative" }, { label: "Ad" }, { label: "Headline" }, { label: "Spend", align: "right" }]}
          defaultSort={{ col: 3, dir: "desc" }}
          rows={untagged.map((a) => ({
            id: a.id,
            cells: [
              { node: <span className="num">{a.creative!.id}</span>, value: a.creative!.id },
              { node: a.name, dim: true },
              { node: a.creative!.title ?? "–", value: a.creative!.title ?? null, className: "max-w-[320px] truncate" },
              { node: moneyFmt(o.currency).money(a.totals.spend), value: a.totals.spend },
            ],
          }))}
        />
      )}
    </>
  );
}
