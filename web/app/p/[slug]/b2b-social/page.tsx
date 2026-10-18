import { notFound } from "next/navigation";
import { Shell } from "@/components/shell";
import { B2BSocialPeople } from "@/components/b2b-social-people";
import { LinkedInView, XView } from "@/components/b2b-social-views";
import { Empty, Tabs } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { getProductBySlug } from "@/lib/queries";
import { loadB2BSocial } from "@/lib/b2b-social-data";
import { funnel, parsePeopleFilters, personRows, watchedAccounts, WINDOWS } from "@/lib/b2b-social-people";

export const dynamic = "force-dynamic";

const VIEWS = ["people", "x", "linkedin"] as const;
type View = (typeof VIEWS)[number];

export default async function B2BSocialPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const product = await getProductBySlug(slug);
  if (!product) notFound();
  const data = await loadB2BSocial(product.id);
  const viewParam = typeof sp.view === "string" ? sp.view : "";
  const view: View = (VIEWS as readonly string[]).includes(viewParam) ? (viewParam as View) : "people";
  const tabs = (
    <Tabs
      items={[
        { key: "people", label: "People to reach out to", href: `/p/${slug}/b2b-social` },
        { key: "x", label: "Content on X", href: `/p/${slug}/b2b-social?view=x` },
        { key: "linkedin", label: "Content on LinkedIn", href: `/p/${slug}/b2b-social?view=linkedin` },
      ]}
      active={view}
    />
  );
  const rows = data ? personRows(data) : [];
  return (
    <Shell
      title="B2B Social"
      subtitle="People who just showed buying signals on LinkedIn and X, who they are, and what to say to them."
      action={data ? <span className="text-[12.5px] text-fg-3">Data from {fmtDate(data.capturedAt)}</span> : undefined}
      tabs={data ? tabs : undefined}
    >
      {!data ? (
        <Empty>
          Nothing watched yet. Add accounts and run <code>pnpm b2b-social sync --product {slug}</code> (see <code>docs/B2B_SOCIAL_MVP.md</code>).
        </Empty>
      ) : view === "x" ? (
        <XView data={data} />
      ) : view === "linkedin" ? (
        <LinkedInView data={data} />
      ) : (
        <B2BSocialPeople
          rows={rows}
          accounts={watchedAccounts(data, rows)}
          funnels={Object.fromEntries(WINDOWS.map((w) => [w, funnel(data, w)])) as Record<(typeof WINDOWS)[number], { comments: number; identified: number }>}
          capturedAt={data.capturedAt}
          slug={slug}
          initial={parsePeopleFilters(sp)}
        />
      )}
    </Shell>
  );
}
