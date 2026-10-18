"use client";

import { useMemo, useState } from "react";
import { DataTable, type Row } from "@/components/data-table";
import { ActiveFilters, Chips, Modal, SearchInput, Toggle, useUrlState, type ActiveFilter } from "@/components/controls";
import { Badge, Button, NameCell, Stat, type BadgeTone } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { COMPANY_TIER_LABEL, OUTREACH_REASON_LABEL, OUTREACH_REASONS, SENIORITY_LABEL, type OutreachReason, type ReachGroup } from "@/lib/b2b-social";
import {
  COMPANY_FILTER_LABEL,
  COMPANY_FILTERS,
  LEVEL_FILTER_LABEL,
  LEVEL_FILTERS,
  NO_PEOPLE_FILTERS,
  filterPeople,
  matchesPeopleFilters,
  peopleCsv,
  peopleFiltersHref,
  windowSince,
  type CompanyFilter,
  type LevelFilter,
  type PeopleFilters,
  type PersonRow,
  type WatchedAccount,
  type Window,
} from "@/lib/b2b-social-people";

/*
 * B2B Social's main view: everyone worth a message, why, and what to say. Rows arrive once from the server; filters,
 * quick views and the person panel all work in the browser and the URL follows. Pure logic: lib/b2b-social-people.ts.
 */

const REASON_TONE: Record<OutreachReason, BadgeTone> = { switching: "red", using: "green", asking: "accent", evaluating: "warn", senior: "neutral" };
const GROUP_LABEL: Record<ReachGroup, string> = { company: "Your company", team: "Your team", competitor: "Competitors" };
const WINDOW_LABEL: Record<Window, string> = { "7": "last 7 days", "30": "last 30 days", all: "all time" };

const QUICK_VIEWS: { key: string; label: string; patch: Partial<PeopleFilters> }[] = [
  { key: "everyone", label: "Everyone", patch: { reason: "", company: "", level: "" } },
  { key: "enterprise", label: "Enterprise only", patch: { reason: "", company: "enterprise", level: "" } },
  { key: "switching", label: "Switching from a competitor", patch: { reason: "switching", company: "", level: "" } },
  { key: "users", label: "Already users", patch: { reason: "using", company: "", level: "" } },
  { key: "startups", label: "Startups and YC", patch: { reason: "", company: "yc", level: "" } },
];

function quickKey(f: PeopleFilters): string {
  return QUICK_VIEWS.find((v) => Object.entries(v.patch).every(([k, val]) => f[k as keyof PeopleFilters] === val))?.key ?? "";
}

function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { key: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <label>
      <span className="sr-only">{label}</span>
      <select className="control !w-auto" value={value} onChange={(e) => onChange(e.target.value as T)} aria-label={label}>
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function B2BSocialPeople({
  rows,
  accounts,
  funnels,
  capturedAt,
  slug,
  initial,
}: {
  rows: PersonRow[];
  accounts: WatchedAccount[];
  funnels: Record<Window, { comments: number; identified: number }>;
  capturedAt: string;
  slug: string;
  initial: PeopleFilters;
}) {
  const [f, setF] = useState(initial);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showWatched, setShowWatched] = useState(false);
  useUrlState(peopleFiltersHref(f));
  const update = (patch: Partial<PeopleFilters>) => setF((cur) => ({ ...cur, ...patch }));

  const shown = useMemo(() => filterPeople(rows, f, capturedAt), [rows, f, capturedAt]);
  const inWindow = useMemo(() => filterPeople(rows, { ...NO_PEOPLE_FILTERS, window: f.window }, capturedAt), [rows, f.window, capturedAt]);
  const since = windowSince(capturedAt, f.window);
  const quickCount = (patch: Partial<PeopleFilters>) => rows.filter((r) => matchesPeopleFilters(r, { ...f, ...patch, q: "" }, since)).length;
  const funnel = funnels[f.window];
  const groups = (["company", "team", "competitor"] as const).map((g) => ({ g, list: accounts.filter((a) => a.group === g) })).filter((x) => x.list.length);
  const platformCount = (p: string) => accounts.filter((a) => a.platform === p).length;
  const open = shown.findIndex((r) => r.id === openId);
  const person = open >= 0 ? shown[open] : null;
  const accountName = accounts.find((a) => a.handle === f.account)?.name ?? f.account;

  const active: ActiveFilter[] = [
    f.reason && { key: "why", label: OUTREACH_REASON_LABEL[f.reason], remove: () => update({ reason: "" }) },
    f.company && { key: "co", label: COMPANY_FILTER_LABEL[f.company], remove: () => update({ company: "" }) },
    f.level && { key: "lvl", label: LEVEL_FILTER_LABEL[f.level], remove: () => update({ level: "" }) },
    f.source && { key: "src", label: f.source === "x" ? "X only" : "LinkedIn only", remove: () => update({ source: "" }) },
    f.account && { key: "acct", label: `On ${accountName}'s posts`, remove: () => update({ account: "" }) },
    f.q && { key: "q", label: `"${f.q}"`, remove: () => update({ q: "" }) },
  ].filter(Boolean) as ActiveFilter[];

  const tableRows: Row[] = shown.map((r) => ({
    id: r.id,
    onClick: () => setOpenId(r.id),
    cells: [
      { node: <NameCell name={r.name} sub={r.title ?? r.location ?? undefined} />, value: r.name },
      {
        node: (
          <span className="block leading-tight">
            {r.company ?? "–"}
            {r.tierLabel && <span className="block text-[11.5px] text-fg-3">{r.tierLabel}</span>}
          </span>
        ),
        value: r.company,
      },
      { node: <Badge tone={REASON_TONE[r.reason]}>{OUTREACH_REASON_LABEL[r.reason]}</Badge>, value: OUTREACH_REASONS.indexOf(r.reason) },
      {
        node: (
          <span className="block whitespace-normal leading-snug min-w-[300px] max-w-[520px]">
            &ldquo;{Array.from(r.quote.replace(/\s+/g, " ")).slice(0, 150).join("")}
            {r.quote.length > 150 ? "…" : ""}&rdquo;
            <span className="block text-[11.5px] text-fg-3 mt-0.5">
              {r.platform === "x" ? "X" : "LinkedIn"} · on {r.accountGroup === "competitor" ? "competitor" : r.accountGroup === "team" ? "team member" : "company"} {r.accountName}
              &apos;s post · {fmtDate(r.postDate)}
            </span>
          </span>
        ),
        value: r.postDate,
      },
      { node: r.score, value: r.score },
    ],
  }));

  return (
    <div className="flex flex-col gap-5">
      <section aria-label="How it works" className="card p-4 flex flex-col gap-3">
        <ol className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          {[
            { n: "1 · Watch", big: `${accounts.length} accounts' posts`, sub: "your company, your team, competitors" },
            { n: "2 · Collect", big: `${funnel.comments.toLocaleString("en-US")} comments`, sub: "replies on X, comments on LinkedIn" },
            { n: "3 · Identify", big: `${funnel.identified} people`, sub: "job, company, size, Fortune 500 and YC" },
            { n: "4 · Qualify", big: `${inWindow.length} worth a message`, sub: "a reason, their words, an opener" },
          ].map((s, i) => (
            <li key={s.n} className={`rounded-[4px] px-3 py-2.5 flex flex-col gap-0.5 ${i === 3 ? "bg-signal/30" : "bg-bg-3"}`}>
              <span className="num text-[11px] text-fg-3 uppercase">{s.n}</span>
              <span className="font-semibold">{s.big}</span>
              <span className="text-[12px] text-fg-2">{s.sub}</span>
            </li>
          ))}
        </ol>
        <p className="text-[12.5px] text-fg-2">
          <span className="font-semibold text-fg">Stack</span> · ScrapeCreators: LinkedIn posts, comments, profiles and company pages · X API: replies · Exa: job titles and X-to-LinkedIn matches ·
          Fortune 500 and YC lists. Counts are for the {WINDOW_LABEL[f.window]}.
        </p>
      </section>

      <section aria-label="What we watch" className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="text-[13px]">
            <span className="font-semibold">Watching</span>
            <span className="text-fg-2">
              {" "}
              · {groups.map(({ g, list }) => `${list.length} ${GROUP_LABEL[g].toLowerCase().replace("your ", "")}`).join(", ")} · LinkedIn {platformCount("linkedin")}, X {platformCount("x")}
            </span>
          </p>
          <Button size="sm" aria-expanded={showWatched} onClick={() => setShowWatched((v) => !v)}>
            {showWatched ? "Hide accounts" : `See all ${accounts.length} accounts`}
          </Button>
        </div>
        {showWatched && (
          <div className="border-t border-line-2 px-4 py-3 grid gap-4 lg:grid-cols-3">
            {groups.map(({ g, list }) => (
              <div key={g}>
                <h3 className="num text-[11px] uppercase text-fg-3 mb-1.5">
                  {GROUP_LABEL[g]} · {list.length}
                </h3>
                <ul className="flex flex-col">
                  {list.map((a) => (
                    <li key={`${a.platform}:${a.handle}`}>
                      <button
                        type="button"
                        onClick={() => update({ account: f.account === a.handle ? "" : a.handle })}
                        aria-pressed={f.account === a.handle}
                        className={`w-full flex items-center justify-between gap-2 text-left px-2 py-1.5 rounded-[3px] text-[13px] hover:bg-bg-3 ${f.account === a.handle ? "bg-bg-3 font-semibold" : ""}`}
                      >
                        <span className="truncate">
                          {a.name} <span className="text-fg-3 text-[11.5px]">{a.platform === "x" ? "X" : "LinkedIn"}</span>
                        </span>
                        <span className="num text-[11.5px] text-fg-3 shrink-0" title="Posts collected · people who commented · worth a message">
                          {a.posts} · {a.people} · <span className="text-fg">{a.worth}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <p className="lg:col-span-3 text-[12px] text-fg-3">Numbers: posts collected · people who commented · worth a message. Click an account to see only people from its posts.</p>
          </div>
        )}
      </section>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="Worth a message" value={inWindow.length} hint={WINDOW_LABEL[f.window]} tone="accent" />
        <Stat label="Unhappy with a competitor" value={inWindow.filter((r) => r.reason === "switching").length} hint="switching moment" />
        <Stat label="Already users" value={inWindow.filter((r) => r.reason === "using").length} hint="expansion" />
        <Stat label="Asking or comparing" value={inWindow.filter((r) => r.reason === "asking" || r.reason === "evaluating").length} hint="evaluating" />
        <Stat label="At Fortune 500 or 10k+" value={inWindow.filter((r) => r.tier === "fortune500" || r.tier === "enterprise").length} hint="enterprise" />
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Toggle<Window>
            label="Time window"
            active={f.window}
            onChange={(window) => update({ window })}
            items={[
              { key: "7", label: "Last 7 days" },
              { key: "30", label: "30 days" },
              { key: "all", label: "All time" },
            ]}
          />
          <Select<OutreachReason | "">
            label="Why"
            value={f.reason}
            onChange={(reason) => update({ reason })}
            options={[{ key: "", label: "Any reason" }, ...OUTREACH_REASONS.map((k) => ({ key: k, label: OUTREACH_REASON_LABEL[k] }))]}
          />
          <Select<CompanyFilter> label="Company" value={f.company} onChange={(company) => update({ company })} options={COMPANY_FILTERS.map((k) => ({ key: k, label: COMPANY_FILTER_LABEL[k] }))} />
          <Select<LevelFilter> label="Level" value={f.level} onChange={(level) => update({ level })} options={LEVEL_FILTERS.map((k) => ({ key: k, label: LEVEL_FILTER_LABEL[k] }))} />
          <Select<"" | "x" | "linkedin">
            label="Source"
            value={f.source}
            onChange={(source) => update({ source })}
            options={[
              { key: "", label: "X and LinkedIn" },
              { key: "x", label: "X only" },
              { key: "linkedin", label: "LinkedIn only" },
            ]}
          />
          <div className="flex-1 min-w-[220px]">
            <SearchInput value={f.q} onChange={(q) => update({ q })} placeholder="Search people, companies, quotes" label="Search" />
          </div>
          <Button variant="primary" onClick={() => download(`${slug}-b2b-social-${capturedAt}.csv`, peopleCsv(shown))}>
            Export CSV for Clay
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-fg-3">Quick views</span>
          <Chips
            active={quickKey(f)}
            onChange={(key) => update(QUICK_VIEWS.find((v) => v.key === key)?.patch ?? QUICK_VIEWS[0]!.patch)}
            items={QUICK_VIEWS.map((v) => ({ key: v.key, label: `${v.label} ${quickCount(v.patch)}` }))}
          />
        </div>
        <ActiveFilters filters={active} onClear={() => setF({ ...NO_PEOPLE_FILTERS, window: f.window })} />
      </div>

      <DataTable
        columns={[{ label: "Person" }, { label: "Company" }, { label: "Why now" }, { label: "What they said" }, { label: "Score", align: "right" }]}
        rows={tableRows}
        defaultSort={{ col: 4, dir: "desc" }}
        empty={`Nobody matches in the ${WINDOW_LABEL[f.window]}. Try a longer window or fewer filters.`}
        dense
      />

      <Modal
        open={!!person}
        onClose={() => setOpenId(null)}
        onPrev={open > 0 ? () => setOpenId(shown[open - 1]!.id) : null}
        onNext={open >= 0 && open < shown.length - 1 ? () => setOpenId(shown[open + 1]!.id) : null}
        position={person ? `${open + 1} of ${shown.length}` : undefined}
        label="Person"
        header={person && <span className="font-semibold truncate">{person.name}</span>}
      >
        {person && <PersonPanel p={person} />}
      </Modal>
    </div>
  );
}

function PersonPanel({ p }: { p: PersonRow }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="p-5 flex flex-col gap-5 overflow-y-auto max-h-[calc(100dvh-80px)] max-w-[720px]">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={REASON_TONE[p.reason]}>{OUTREACH_REASON_LABEL[p.reason]}</Badge>
          {p.tierLabel && <Badge tone="green">{p.tierLabel}</Badge>}
          {p.seniority !== "unknown" && <Badge>{SENIORITY_LABEL[p.seniority]}</Badge>}
        </div>
        <h2 className="text-[22px] font-semibold">{p.name}</h2>
        <p className="text-fg-2">{[p.title, p.company].filter(Boolean).join(" at ") || "Job unknown"}</p>
      </div>
      <section className="flex flex-col gap-2">
        <h3 className="label">Why now</h3>
        <blockquote className="rounded-[4px] bg-bg-3 px-3.5 py-3 text-[14px] leading-relaxed whitespace-pre-line">&ldquo;{p.quote}&rdquo;</blockquote>
        <p className="text-[12.5px] text-fg-2">
          {p.commentUrl ? (
            <a href={p.commentUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
              {p.platform === "x" ? "X reply" : "Comment"}
            </a>
          ) : p.platform === "x" ? (
            "X reply"
          ) : (
            "LinkedIn comment"
          )}
          {p.commentDate ? ` · ${fmtDate(p.commentDate)}` : ""} on{" "}
          {p.postUrl ? (
            <a href={p.postUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
              {p.accountName}&apos;s post
            </a>
          ) : (
            `${p.accountName}'s post`
          )}{" "}
          · {fmtDate(p.postDate)}
          {p.accountGroup === "competitor" ? " · a competitor" : ""}
          {p.more ? ` · commented ${p.more} more time${p.more > 1 ? "s" : ""}` : ""}
        </p>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="label">Who they are</h3>
        <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
          <dt className="text-fg-3">Title</dt>
          <dd>{p.title ?? "–"}</dd>
          <dt className="text-fg-3">Company</dt>
          <dd>{p.company ?? "–"}</dd>
          <dt className="text-fg-3">Company size</dt>
          <dd>{p.tierLabel ?? COMPANY_TIER_LABEL[p.tier]}</dd>
          <dt className="text-fg-3">Level</dt>
          <dd>{SENIORITY_LABEL[p.seniority]}</dd>
          <dt className="text-fg-3">Location</dt>
          <dd>{p.location ?? "–"}</dd>
          <dt className="text-fg-3">How we know</dt>
          <dd className="text-fg-2">{p.howWeKnow}</dd>
        </dl>
      </section>
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="label">Suggested opener</h3>
          <Button
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(p.opener);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="rounded-[4px] border border-line px-3.5 py-3 text-[13.5px] leading-relaxed">{p.opener}</p>
      </section>
      {p.platform === "linkedin" && <p className="text-[12px] text-fg-3 -mb-3">LinkedIn doesn&apos;t give a link to a single comment; it&apos;s under the post.</p>}
      <div className="flex flex-wrap gap-2">
        {p.linkedinUrl && (
          <a className="btn btn-primary" href={p.linkedinUrl} target="_blank" rel="noopener noreferrer">
            Open LinkedIn
          </a>
        )}
        {p.xUrl && (
          <a className={`btn ${p.linkedinUrl ? "" : "btn-primary"}`} href={p.xUrl} target="_blank" rel="noopener noreferrer">
            Open X
          </a>
        )}
        {p.commentUrl && (
          <a className="btn" href={p.commentUrl} target="_blank" rel="noopener noreferrer">
            Open the reply
          </a>
        )}
        {p.postUrl && (
          <a className="btn" href={p.postUrl} target="_blank" rel="noopener noreferrer">
            Open the post
          </a>
        )}
      </div>
    </div>
  );
}
