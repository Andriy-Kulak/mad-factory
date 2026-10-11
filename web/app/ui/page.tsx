import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, Button, ButtonLink, Card, Empty, Field, Meter, NameCell, Pair, Panel, SectionHead, Segmented, Stat, StatusDot, Table, Tabs, Td, Th } from "@/components/ui";
import { MediaTag } from "@/components/media";
import { DataTable } from "@/components/data-table";
import { SwitchField } from "@/components/switch";
import { BrowseDemo } from "./browse-demo";

export const metadata = { title: "Components · Mad Factory" };

/** Living reference for the shared components. Sample values are placeholders. */
export default function ComponentsPage() {
  return (
    <div className="min-h-screen">
      <div className="sticky top-0 z-30 h-12 flex items-center gap-3 px-4 bg-chrome border-b border-chrome-line text-[13px] text-chrome-fg-2">
        <Link href="/" className="font-semibold text-chrome-fg hover:text-signal transition-colors duration-200">
          Mad Factory
        </Link>
        <span className="text-chrome-fg-3">/</span>
        <span className="text-chrome-fg">Components</span>
        <Link href="/ui/frame" className="ml-auto hover:text-chrome-fg transition-colors duration-200">
          App frame preview →
        </Link>
      </div>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-10 enter">
        <header>
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.01em]">Components</h1>
          <p className="text-fg-3 text-[13px] mt-1 max-w-2xl">
            Every shared building block in one place. Styles live in <code className="num">app/globals.css</code>, components in <code className="num">components/ui.tsx</code> (static),{" "}
            <code className="num">controls.tsx</code> (interactive), <code className="num">media.tsx</code>, <code className="num">data-table.tsx</code>, <code className="num">skeleton.tsx</code> and{" "}
            <code className="num">switch.tsx</code>. Use these before writing new markup; <code className="num">web/DESIGN.md</code> says why they look and behave the way they do.
          </p>
        </header>

        <Section title="Colour">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {[
              ["--chrome", "Chrome"],
              ["--signal", "Signal · primary"],
              ["--bg", "Workspace"],
              ["--bg-2", "Panel"],
              ["--bg-3", "Subtle fill"],
              ["--line", "Line"],
              ["--fg", "Text"],
              ["--fg-2", "Text 2"],
              ["--fg-3", "Text 3"],
              ["--accent", "Data accent"],
              ["--good", "Good"],
              ["--warn", "Warn"],
              ["--danger", "Danger"],
            ].map(([v, name]) => (
              <div key={v} className="card overflow-hidden">
                <div className="h-14 border-b border-line" style={{ background: `var(${v})` }} />
                <div className="px-3 py-2">
                  <div className="text-[13px] font-medium">{name}</div>
                  <div className="num text-[11px] text-fg-3">{v}</div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Type">
          <Card className="p-5 flex flex-col gap-3">
            <div className="text-[26px] font-semibold tracking-[-0.01em] leading-tight">Page title · Geist 26</div>
            <SectionHead>Section head · Geist 15 semibold</SectionHead>
            <p className="text-[14px] max-w-2xl">Body copy is Geist 14 on 1.5 line height. Sentence case everywhere; Geist Mono only for numbers so columns line up.</p>
            <div className="flex gap-6 items-baseline">
              <span className="label">Label</span>
              <span className="num text-[26px]">1,284</span>
              <span className="num text-fg-3 text-xs">$3.75 per install</span>
            </div>
          </Card>
        </Section>

        <Section title="Buttons" note="One primary action per view. Secondary for everything else; ghost for low-stakes; danger only for destructive actions.">
          <Card className="p-5 flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary">Sync now</Button>
              <Button>Export</Button>
              <Button variant="ghost">Cancel</Button>
              <Button variant="danger">Remove</Button>
              <Button disabled>Disabled</Button>
              <ButtonLink href="/ui">Link as button</ButtonLink>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" size="sm">
                Add keyword
              </Button>
              <Button size="sm">Pause</Button>
              <Button variant="ghost" size="sm">
                View raw
              </Button>
              <Button variant="danger" size="sm">
                Remove
              </Button>
            </div>
          </Card>
        </Section>

        <Section title="Inputs and toggles">
          <Card className="p-5 grid sm:grid-cols-3 gap-4 items-end">
            <label className="flex flex-col gap-1.5">
              <span className="label">Search</span>
              <input className="control" placeholder="Search advertiser or copy" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="label">Status</span>
              <select className="control">
                <option>Active + ended</option>
                <option>Active only</option>
              </select>
            </label>
            <SwitchField name="demo" defaultChecked label="Winners only" />
            <label className="flex flex-col gap-1.5 sm:col-span-3">
              <span className="label">Notes</span>
              <textarea className="control h-auto py-2" rows={3} placeholder="One item per line" />
            </label>
          </Card>
        </Section>

        <Section title="Segmented control" note="Link-based, for server-rendered views. In a browse screen use Toggle from controls.tsx instead. The active item is filled.">
          <Card className="p-5 flex flex-wrap gap-4 items-center">
            <Segmented label="Range" active="28" items={["7", "14", "28", "90"].map((d) => ({ key: d, label: `${d}D`, href: "/ui" }))} />
            <Segmented
              label="Sort"
              size="sm"
              active="views"
              items={[
                { key: "outlier", label: "Outliers", href: "/ui" },
                { key: "views", label: "Most views", href: "/ui" },
                { key: "newest", label: "Newest", href: "/ui" },
              ]}
            />
          </Card>
        </Section>

        <Section
          title="Browse controls"
          note="components/controls.tsx: state-driven filters for grids and lists. Changes apply instantly in the browser; useUrlState keeps the URL shareable. Organic and Competitor ads are built from these."
        >
          <BrowseDemo />
        </Section>

        <Section title="Page tabs" note="Tabs (links) split one screen into views, e.g. Apple ads → Overview · Experiments · Keywords. Pass to Shell's tabs prop.">
          <Card className="px-5 pt-2 pb-4">
            <Tabs
              active="a"
              items={[
                { key: "a", label: "Overview", href: "/ui" },
                { key: "b", label: "Experiments", href: "/ui" },
                { key: "c", label: "Keywords", href: "/ui" },
              ]}
            />
          </Card>
        </Section>

        <Section title="Table cells" note="NameCell groups identity (status dot, thumbnail, name, context line; id in the tooltip). Pair puts a rate or cost under its count.">
          <Card className="p-5 flex flex-wrap items-center gap-10">
            <NameCell name="campaign_one" id="1234567890" tone="green" sub="app promotion · 2 ad sets" />
            <NameCell name="ad_two" id="99887766" tone="neutral" state="paused" thumb={null} sub="ad set one · Example headline" />
            <span className="num">
              <Pair top="331" sub="$6.49" />
            </span>
            <span className="num">
              <Pair top="98.9K" sub="3.5%" />
            </span>
          </Card>
        </Section>

        <Section title="Media tags" note="media.tsx: Media (image/video, first frame in grids), HoverVideo, PreviewPane (inside Modal) and MediaTag on top of thumbnails.">
          <Card className="p-5 flex flex-wrap gap-2 bg-chrome-3">
            <MediaTag tone="signal">Winner</MediaTag>
            <MediaTag tone="good">174d</MediaTag>
            <MediaTag>3 versions</MediaTag>
            <MediaTag dot>live</MediaTag>
          </Card>
        </Section>

        <Section title="Status">
          <Card className="p-5 flex flex-wrap gap-3 items-center">
            <Badge tone="green">Active</Badge>
            <Badge tone="warn">Learning</Badge>
            <Badge>Paused</Badge>
            <Badge tone="red">Ended</Badge>
            <Badge tone="accent">Winner</Badge>
            <span className="w-px h-5 bg-line mx-2" />
            <StatusDot tone="green">Live</StatusDot>
            <StatusDot tone="warn">Learning</StatusDot>
            <StatusDot>Hold</StatusDot>
            <StatusDot tone="red">Error</StatusDot>
          </Card>
        </Section>

        <Section title="Stats and meters">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Spend" value="$4,812" hint="+12.4% vs prior" />
            <Stat label="Installs" value="1,284" tone="accent" meter={0.84} hint="+18.1% vs prior" />
            <Stat label="Cost / install" value="$3.75" tone="accent" meter={0.46} />
            <Stat label="Cost / trial" value="$15.42" tone="warn" meter={0.66} hint="above target" />
          </div>
          <Card className="p-5 mt-3 flex flex-col gap-2 max-w-sm">
            <Meter value={0.3} />
            <Meter value={0.6} tone="accent" />
            <Meter value={0.9} tone="warn" />
          </Card>
        </Section>

        <Section
          title="Tables"
          note="DataTable sorts on header click (arrows show the direction; costs sort low-first) and keeps the header pinned when given a max height. dense + stickyFirst for wide metric tables; views (row tags) and searchLabel add a toolbar. Plain Table for short static lists."
        >
          <DataTable
            maxHeight="320px"
            dense
            stickyFirst
            searchLabel="Search campaigns"
            views={[
              { key: "all", label: "All" },
              { key: "active", label: "Active" },
            ]}
            defaultSort={{ col: 2, dir: "desc" }}
            columns={[{ label: "Campaign" }, { label: "Status" }, { label: "Spend", align: "right" }, { label: "Installs", align: "right" }, { label: "$ / install", align: "right", firstDir: "asc" }]}
            rows={SAMPLE.map((r) => ({
              id: r.name,
              tags: r.status === "Active" ? ["active"] : [],
              search: r.name,
              cells: [
                { node: <span className="font-semibold">{r.name}</span>, value: r.name },
                { node: <Badge tone={r.status === "Active" ? "green" : r.status === "Learning" ? "warn" : "neutral"}>{r.status}</Badge>, value: r.status },
                { node: `$${r.spend.toLocaleString("en-US")}`, value: r.spend },
                { node: r.installs.toLocaleString("en-US"), value: r.installs },
                { node: r.installs ? `$${(r.spend / r.installs).toFixed(2)}` : "–", value: r.installs ? r.spend / r.installs : null, dim: !r.installs },
              ],
            }))}
          />
          <Table className="">
            <thead>
              <tr>
                <Th>Term</Th>
                <Th right>Popularity</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Td>example term</Td>
                <Td right>42</Td>
              </tr>
              <tr>
                <Td>another term</Td>
                <Td right dim>
                  5
                </Td>
              </tr>
            </tbody>
          </Table>
        </Section>

        <Section title="Panels, disclosure, empty">
          <div className="grid md:grid-cols-2 gap-3">
            <Panel title="Panel title" right="by CPI">
              <div className="px-4 pb-4 grid grid-cols-2 gap-4">
                <Field label="Field">Value</Field>
                <Field label="Missing">{null}</Field>
              </div>
            </Panel>
            <details className="card group">
              <summary className="px-4 h-12 flex items-center gap-3 cursor-pointer list-none rounded-[3px] transition-colors duration-150 hover:bg-bg-3 [&::-webkit-details-marker]:hidden">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  aria-hidden="true"
                  className="text-fg-3 transition-transform duration-[280ms] ease-drawer group-open:rotate-90"
                >
                  <path d="M9 6l6 6-6 6" />
                </svg>
                <span className="text-[14px] font-semibold">Disclosure</span>
              </summary>
              <div className="px-4 pb-4 pt-3 border-t border-line text-[13px] text-fg-2">Opens and closes with a height transition in browsers that support it; elsewhere it simply appears.</div>
            </details>
          </div>
          <div className="mt-3">
            <Empty>No ads match. Empty states say what is missing and how to fill it.</Empty>
          </div>
        </Section>

        <Section title="Motion" note="Short and functional. Every transition respects prefers-reduced-motion.">
          <Card className="p-5 num text-[12px] text-fg-2 grid sm:grid-cols-3 gap-3">
            <div>
              <span className="label block">Fast · 120ms</span>button press, row hover
            </div>
            <div>
              <span className="label block">Base · 180ms ease-out</span>colours, borders, focus
            </div>
            <div>
              <span className="label block">Slow · 280ms drawer</span>sidebar, disclosure, switch, sort
            </div>
          </Card>
        </Section>
      </main>
    </div>
  );
}

const SAMPLE = [
  { name: "Prospecting · Broad", status: "Active", spend: 2140, installs: 612 },
  { name: "Prospecting · Interests", status: "Active", spend: 1288, installs: 341 },
  { name: "Creative test · Hooks", status: "Learning", spend: 904, installs: 233 },
  { name: "Retargeting · 30d", status: "Paused", spend: 480, installs: 98 },
  { name: "Brand · Exact", status: "Paused", spend: 0, installs: 0 },
];

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section>
      <SectionHead right={note && <span className="text-xs text-fg-3 max-w-xl">{note}</span>}>{title}</SectionHead>
      {children}
    </section>
  );
}
