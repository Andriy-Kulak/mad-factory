import { notFound } from "next/navigation";
import { Shell } from "@/components/shell";
import { CommentersView, LEAD_WINDOWS, LeadsView, LinkedInView, OutreachView, XView, type LeadWindow } from "@/components/social-reach-views";
import { Empty, Tabs } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { getProductBySlug } from "@/lib/queries";
import { loadSocialReach } from "@/lib/social-reach-data";

export const dynamic = "force-dynamic";

const VIEWS = ["outreach", "leads", "x", "linkedin", "commenters"] as const;
type View = (typeof VIEWS)[number];

export default async function SocialReachPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ view?: string; days?: string }> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const product = await getProductBySlug(slug);
  if (!product) notFound();
  const data = await loadSocialReach(slug);
  const window: LeadWindow = (LEAD_WINDOWS as readonly string[]).includes(sp.days ?? "") ? (sp.days as LeadWindow) : "7";
  const view: View = (VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as View) : "outreach";
  const tabs = (
    <Tabs
      items={[
        { key: "outreach", label: "Reach out", href: `/p/${slug}/reach` },
        { key: "leads", label: "Enterprise leads", href: `/p/${slug}/reach?view=leads` },
        { key: "x", label: "X", href: `/p/${slug}/reach?view=x` },
        { key: "linkedin", label: "LinkedIn", href: `/p/${slug}/reach?view=linkedin` },
        { key: "commenters", label: "All comments", href: `/p/${slug}/reach?view=commenters` },
      ]}
      active={view}
    />
  );
  return (
    <Shell
      title="Social reach"
      subtitle={
        data
          ? `Snapshot from ${fmtDate(data.capturedAt)} · ${data.credits} ScrapeCreators credits · stored in local/${slug}/social-reach.json`
          : "X and LinkedIn reach for the company, its team and competitors"
      }
      tabs={data ? tabs : undefined}
    >
      {!data ? (
        <Empty>
          No snapshot for this product. Save one as <code>local/{slug}/social-reach.json</code> (format in <code>web/lib/social-reach.ts</code>); it stays on this machine.
        </Empty>
      ) : view === "outreach" ? (
        <OutreachView data={data} slug={slug} window={window} />
      ) : view === "leads" ? (
        <LeadsView data={data} slug={slug} window={window} />
      ) : view === "linkedin" ? (
        <LinkedInView data={data} />
      ) : view === "commenters" ? (
        <CommentersView data={data} slug={slug} />
      ) : (
        <XView data={data} />
      )}
    </Shell>
  );
}
