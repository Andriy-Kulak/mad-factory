import Link from "next/link";
import { notFound } from "next/navigation";
import { getAd } from "@/lib/queries";
import { daysBetween, fmtBytes, fmtDate, fmtDateTime } from "@/lib/format";
import { Shell } from "@/components/shell";
import { Badge, Card, Field, SectionHead } from "@/components/ui";
import { hookOf } from "@/lib/ad-cards";

export const dynamic = "force-dynamic";

const pretty = (v: unknown) => (v == null ? null : typeof v === "object" ? JSON.stringify(v) : String(v));

export default async function AdPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const ad = await getAd(id);
  if (!ad) notFound();
  const running = daysBetween(ad.start_date, ad.is_active ? null : ad.end_date);
  const libraryUrl = ad.source === "meta" ? `https://www.facebook.com/ads/library/?id=${ad.external_id}` : null;

  return (
    <Shell
      title={<span className="flex items-center gap-2"><Link href={`/p/${slug}/ads`} className="text-fg-3 hover:text-fg">Competitor ads</Link><span className="text-fg-3">/</span><span>{ad.advertiser_name ?? "Unknown advertiser"}</span></span>}
      action={libraryUrl && <a href={libraryUrl} target="_blank" rel="noreferrer" className="btn">Open in Ad Library</a>}
    >
      <div className="flex items-center gap-3 mb-5">
        <h2 className="text-xl font-semibold leading-tight">{hookOf({ title: ad.title, body: ad.body_text, advertiserName: ad.advertiser_name })}</h2>
        <Badge tone={ad.is_active ? "green" : "red"}>{ad.is_active ? "active" : ad.is_active === false ? "ended" : "unknown"}</Badge>
        {running != null && <span className="num text-fg-2 text-[13px]">{running} days</span>}
      </div>

      <div className="grid lg:grid-cols-3 gap-3">
        <div className="flex flex-col gap-3">
          {ad.creatives.length === 0 && <Card className="p-5 text-fg-3">No media stored for this ad.</Card>}
          {ad.creatives.map((c, i) => (
            <Card key={c.sha256} className="overflow-hidden">
              <div className="bg-fg aspect-[4/5]">
                {c.public_url ? (
                  c.media_type === "image"
                    ? <img src={c.public_url} alt="" className="w-full h-full object-contain" />
                    : <video src={c.public_url} controls preload="metadata" className="w-full h-full object-contain" />
                ) : (
                  <div className="h-full flex items-center justify-center text-fg-3 text-xs">stored locally: {c.storage_key}</div>
                )}
              </div>
              <div className="num text-xs text-fg-3 flex justify-between px-3 py-2">
                <span>{c.media_type} {i + 1} · {fmtBytes(Number(c.bytes))}</span>
                <span>{c.sha256.slice(0, 12)}</span>
              </div>
            </Card>
          ))}
        </div>

        <div className="lg:col-span-2 flex flex-col gap-3">
          <Card className="p-5">
            <div className="label mb-2">Body</div>
            <p className="text-[15px] leading-relaxed whitespace-pre-line">{ad.body_text ?? <span className="text-fg-3">–</span>}</p>
          </Card>
          <Card className="p-5 grid sm:grid-cols-2 gap-x-8 gap-y-5">
            <Field label="Title">{ad.title}</Field>
            <Field label="CTA">{ad.cta_text}</Field>
            <Field label="Link">{ad.link_url && <a href={ad.link_url} target="_blank" rel="noreferrer" className="break-all text-fg-2 hover:text-fg">{ad.link_url}</a>}</Field>
            <Field label="Platforms">{ad.platforms.join(", ")}</Field>
            <Field label="Started">{fmtDate(ad.start_date)}</Field>
            <Field label="Ended">{ad.end_date ? fmtDate(ad.end_date) : ad.is_active ? "still running" : null}</Field>
            <Field label="Collation">{ad.collation_id && `${ad.collation_id} (${ad.collation_count ?? 1} variants)`}</Field>
            <Field label="Currency">{ad.currency}</Field>
            <Field label="Reach estimate">{pretty(ad.reach_estimate)}</Field>
            <Field label="Spend">{pretty(ad.spend)}</Field>
            <Field label="Total active time">{pretty(ad.total_active_time)}</Field>
            <Field label="Advertiser id">{ad.advertiser_id}</Field>
            <Field label="First seen">{fmtDateTime(ad.first_seen_at)}</Field>
            <Field label="Last seen">{fmtDateTime(ad.last_seen_at)}</Field>
            <Field label="Ad id">{ad.external_id}</Field>
            <Field label="Also tracked by">
              {ad.products.filter((p) => p.slug !== slug).map((p, i) => (
                <span key={p.id}>{i > 0 && ", "}<Link href={`/p/${p.slug}`} className="hover:text-fg text-fg-2">{p.name}</Link></span>
              ))}
            </Field>
          </Card>
          <Card className="p-5">
            <SectionHead>Raw payload</SectionHead>
            <details>
              <summary className="cursor-pointer text-fg-2 text-[13px]">Show JSON</summary>
              <pre className="num mt-3 text-xs overflow-x-auto max-h-[32rem] overflow-y-auto bg-bg-3 rounded-lg p-3">{JSON.stringify(ad.raw, null, 2)}</pre>
            </details>
          </Card>
        </div>
      </div>
    </Shell>
  );
}
