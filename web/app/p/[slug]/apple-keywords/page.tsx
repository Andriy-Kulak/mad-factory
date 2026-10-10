import { notFound } from "next/navigation";
import { getProductBySlug } from "@/lib/queries";
import { getAppleKeywords } from "@/lib/apple-keywords";
import { fmtDateTime } from "@/lib/format";
import { Shell } from "@/components/shell";
import { Badge, Card, Empty, Meter, Segmented, Stat } from "@/components/ui";
import { DataTable } from "@/components/data-table";

export const dynamic = "force-dynamic";

const RANGES = [7, 14, 28, 90];
const FLOOR = 5;

function Popularity({ v }: { v: number | null }) {
  if (v == null) return <span className="text-fg-3">–</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="num w-7 text-right">{v}</span>
      <Meter value={v / 100} tone={v <= FLOOR ? "neutral" : "accent"} className={`w-24 ${v <= FLOOR ? "opacity-40" : ""}`} />
    </span>
  );
}

export default async function AppleKeywordsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ days?: string }> }) {
  const { slug } = await params;
  const requested = Number((await searchParams).days);
  const days = RANGES.includes(requested) ? requested : 28;
  const product = await getProductBySlug(slug);
  if (!product) notFound();
  const k = await getAppleKeywords(product.id, days);

  const ranges = <Segmented label="Range" active={String(days)} items={RANGES.map((d) => ({ key: String(d), label: `${d}D`, href: `/p/${slug}/apple-keywords?days=${d}` }))} />;
  const refresh = <code className="num">pnpm apple-ads research --product {slug} --terms "a, b, c"</code>;

  if (k.unavailable || !k.rows.length) {
    return (
      <Shell title="Apple keywords" subtitle={product.slug}>
        <Empty>
          {k.unavailable
            ? <>The <code className="num">apple_ads_term_popularity</code> table is not in the database yet — run <code className="num">pnpm db:migrate</code>, then {refresh}. ({k.unavailable})</>
            : <>No popularity readings yet. Pull them with {refresh}.</>}
        </Empty>
      </Shell>
    );
  }

  const above = k.rows.filter((r) => (r.popularity ?? 0) > FLOOR).length;
  const targeted = k.rows.filter((r) => r.targeted.length).length;

  return (
    <Shell title="Apple keywords" subtitle={product.slug} action={ranges}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Terms" value={k.rows.length} hint={`${targeted} targeted in a campaign`} />
        <Stat label="Above Apple's floor" value={above} hint={`popularity > ${FLOOR}`} />
        <Stat label="Last pulled" value={<span className="text-[17px]">{fmtDateTime(k.lastPulledAt)}</span>} hint="per term in the table" />
        <Stat label="Our numbers" value={<span className="text-[17px]">last {days}d</span>} hint={`impressions · taps · installs since ${k.since}`} />
      </div>

      <Card className="p-4 mb-6 text-[13px] text-fg-2 max-w-4xl">
        <span className="font-semibold text-fg">How to read this.</span> Popularity is Apple&apos;s 0–100 score from <code className="num">POST /suggestions/keywords/query</code>, relative across all storefronts (not US volume) and it shifts a little with the seed, so compare within one pull. <span className="font-semibold text-fg">{FLOOR} is the floor</span>: Apple echoes a term at {FLOOR} when it has nothing on it. The right-hand columns are what our own keyword with that exact text actually got — that is the ground truth for bids. Refresh with {refresh}.
      </Card>

      <DataTable dense
        maxHeight="75vh"
        columns={[
          { label: "Term" },
          { label: "Popularity", align: "right", title: "Apple's 0–100 popularity score" },
          { label: "Targeted in" },
          { label: "Bid", align: "right" },
          { label: "Impr", align: "right" },
          { label: "Taps", align: "right" },
          { label: "Installs", align: "right" },
          { label: "Pulled", firstDir: "desc" },
        ]}
        rows={k.rows.map((r) => {
          const t = r.targeted;
          const sum = t.reduce((a, x) => ({ impressions: a.impressions + x.impressions, taps: a.taps + x.taps, installs: a.installs + x.installs }), { impressions: 0, taps: 0, installs: 0 });
          const dim = !t.length;
          const bids = t.flatMap((x) => (x.bid == null ? [] : [x.bid]));
          return {
            id: `${r.country}:${r.term}`,
            cells: [
              { node: <><span className={r.popularity != null && r.popularity > FLOOR ? "font-semibold" : ""}>{r.term}</span> <span className="text-fg-3 text-xs ml-1">{r.country}</span></>, value: r.term },
              { node: <Popularity v={r.popularity} />, value: r.popularity },
              { node: t.length ? t.map((x, i) => <span key={i} className="mr-2">{x.campaignName} <Badge>{x.matchType}</Badge></span>) : "–", value: t[0]?.campaignName ?? null, dim },
              { node: t.length ? [...new Set(t.map((x) => (x.bid == null ? "–" : `$${x.bid.toFixed(2)}`)))].join(" / ") : "–", value: bids.length ? Math.max(...bids) : null, dim },
              { node: t.length ? sum.impressions.toLocaleString("en-US") : "–", value: t.length ? sum.impressions : null, dim: dim || !sum.impressions },
              { node: t.length ? sum.taps : "–", value: t.length ? sum.taps : null, dim: dim || !sum.taps },
              { node: t.length ? sum.installs : "–", value: t.length ? sum.installs : null, dim: dim || !sum.installs },
              { node: fmtDateTime(r.pulled_at), value: r.pulled_at, dim: true },
            ],
          };
        })}
      />
    </Shell>
  );
}
