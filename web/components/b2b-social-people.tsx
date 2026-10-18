"use client";

import { useMemo, useState } from "react";
import { DataTable, type Row } from "@/components/data-table";
import { ActiveFilters, Chips, Modal, SearchInput, Toggle, useUrlState, type ActiveFilter } from "@/components/controls";
import { Badge, Button, NameCell, Stat, type BadgeTone } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { FADE_DAYS, PERSONA_LABEL, ROUTE_LABEL, SCORING, gradeRank, type Route } from "@/lib/b2b-social-grade";
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
  { key: "everyone", label: "Everyone", patch: { route: "", reason: "", company: "", level: "" } },
  { key: "now", label: "Reach out now", patch: { route: "now", reason: "", company: "", level: "" } },
  { key: "enterprise", label: "Enterprise only", patch: { route: "", reason: "", company: "enterprise", level: "" } },
  { key: "switching", label: "Switching from a competitor", patch: { route: "", reason: "switching", company: "", level: "" } },
  { key: "users", label: "Already users", patch: { route: "", reason: "using", company: "", level: "" } },
  { key: "startups", label: "Startups and YC", patch: { route: "", reason: "", company: "yc", level: "" } },
];

const ROUTE_TONE: Record<Route, BadgeTone> = { now: "green", selfserve: "accent", nurture: "neutral" };

const ICON = {
  watch: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  collect: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM8 9h8M8 13h5",
  identify: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6",
  qualify: "M12 2l3 6.5 7 1-5 4.8 1.2 7L12 18l-6.2 3.3L7 14.3 2 9.5l7-1z",
};

function Icon({ d, className = "" }: { d: string; className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d={d} />
    </svg>
  );
}

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
  const [showScoring, setShowScoring] = useState(false);
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
    f.route && { key: "route", label: ROUTE_LABEL[f.route], remove: () => update({ route: "" }) },
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
      { node: <NameCell name={r.name} sub={[r.title ?? r.location, r.persona !== "unknown" ? PERSONA_LABEL[r.persona] : null].filter(Boolean).join(" · ") || undefined} />, value: r.name },
      {
        node: (
          <span className="block leading-tight">
            {r.company ?? "–"}
            {r.tierLabel && <span className="block text-[11.5px] text-fg-3">{r.tierLabel}</span>}
            {r.colleagues > 0 && (
              <span className="block text-[11.5px] text-fg-2">
                +{r.colleagues} more from {r.company}
              </span>
            )}
          </span>
        ),
        value: r.company,
      },
      { node: <Badge tone={REASON_TONE[r.reason]}>{OUTREACH_REASON_LABEL[r.reason]}</Badge>, value: OUTREACH_REASONS.indexOf(r.reason) },
      {
        node: (
          <span className="block whitespace-normal leading-snug min-w-[240px] max-w-[400px]">
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
      {
        node: (
          <span className="flex flex-col items-end gap-0.5">
            <Badge tone={ROUTE_TONE[r.route]}>{r.grade}</Badge>
            <span className="text-[11px] text-fg-3 whitespace-nowrap">{ROUTE_LABEL[r.route]}</span>
          </span>
        ),
        value: -gradeRank(r.fit, r.intent),
      },
    ],
  }));

  return (
    <div className="flex flex-col gap-5">
      <section aria-label="How it works" className="card p-4 sm:p-5">
        <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { icon: ICON.watch, step: "Watch", big: accounts.length, unit: "accounts", sub: "Posts by your company, your team and competitors", tools: ["ScrapeCreators", "X API"] },
            { icon: ICON.collect, step: "Collect", big: funnel.comments, unit: "comments", sub: "Everyone who replied on X or commented on LinkedIn", tools: ["ScrapeCreators", "X API"] },
            { icon: ICON.identify, step: "Identify", big: funnel.identified, unit: "people", sub: "Their job, company and its size", tools: ["LinkedIn profiles", "Exa", "Fortune 500", "YC list"] },
            { icon: ICON.qualify, step: "Qualify", big: inWindow.length, unit: "worth a message", sub: "Fit × Intent grade, their words, an opener", tools: ["Rules, no AI"] },
          ].map((s, i) => (
            <li key={s.step} className={`relative rounded-[6px] p-4 flex flex-col gap-2 ${i === 3 ? "bg-signal/40 border border-signal" : "bg-bg-3"}`}>
              <div className="flex items-center gap-2">
                <span className={`w-8 h-8 grid place-items-center rounded-full ${i === 3 ? "bg-fg text-signal" : "bg-bg-2 text-fg"}`}>
                  <Icon d={s.icon} />
                </span>
                <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-fg-2">
                  {i + 1}. {s.step}
                </span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="num text-[30px] leading-none font-medium tracking-[-0.02em]">{s.big.toLocaleString("en-US")}</span>
                <span className="text-[13px] text-fg-2">{s.unit}</span>
              </div>
              <p className="text-[12.5px] text-fg-2 leading-snug">{s.sub}</p>
              <div className="flex flex-wrap gap-1 mt-auto">
                {s.tools.map((t) => (
                  <span key={t} className="text-[11px] rounded-full border border-line bg-bg-2 px-2 py-0.5 text-fg-2">
                    {t}
                  </span>
                ))}
              </div>
              {i < 3 && (
                <span
                  aria-hidden="true"
                  className="hidden xl:grid absolute -right-[13px] top-1/2 -translate-y-1/2 z-[1] w-[22px] h-[22px] place-items-center rounded-full bg-bg-2 border border-line text-fg-3 text-[13px]"
                >
                  →
                </span>
              )}
            </li>
          ))}
        </ol>
        <p className="text-[12px] text-fg-3 mt-3">Counts are for the {WINDOW_LABEL[f.window]}. Updated by a daily sync.</p>
      </section>

      <section aria-label="How we score" className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="text-[13px]">
            <span className="font-semibold">How we score</span>
            <span className="text-fg-2"> · Fit (right company, right person) × Intent (how strong and fresh the signal is) = a grade like A1, which picks the route</span>
          </p>
          <Button size="sm" aria-expanded={showScoring} onClick={() => setShowScoring((v) => !v)}>
            {showScoring ? "Hide" : "Show the rules"}
          </Button>
        </div>
        {showScoring && (
          <div className="border-t border-line-2 px-4 py-4 grid gap-5 lg:grid-cols-[1fr_1fr_auto]">
            <div>
              <h3 className="label mb-2">Fit: is this the right company and person?</h3>
              <ul className="flex flex-col gap-1.5 text-[13px]">
                {SCORING.fit.map((x) => (
                  <li key={x.grade} className="flex gap-2">
                    <span className="num font-semibold w-5 shrink-0">{x.grade}</span>
                    <span className="text-fg-2">{x.rule}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[12px] text-fg-3 mt-2">Buyer: C-level, founder, VP, director or head. Champion: manager, lead or engineer.</p>
            </div>
            <div>
              <h3 className="label mb-2">Intent: are they showing interest now?</h3>
              <ul className="flex flex-col gap-1.5 text-[13px]">
                {SCORING.intent.map((x) => (
                  <li key={x.grade} className="flex gap-2">
                    <span className="num font-semibold w-5 shrink-0">{x.grade}</span>
                    <span className="text-fg-2">{x.rule}</span>
                  </li>
                ))}
                {SCORING.adjustments.map((a) => (
                  <li key={a} className="flex gap-2 text-[12px] text-fg-3">
                    <span className="w-5 shrink-0">±</span>
                    <span>{a}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="label mb-2">Route</h3>
              <table className="text-[12px] border-collapse">
                <thead>
                  <tr>
                    <th scope="col" className="w-8" />
                    {[1, 2, 3].map((i) => (
                      <th key={i} scope="col" className="num font-medium text-fg-3 px-1 pb-1">
                        {i}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(["A", "B", "C"] as const).map((fit) => (
                    <tr key={fit}>
                      <th scope="row" className="num font-medium text-fg-3 pr-1 text-left">
                        {fit}
                      </th>
                      {([1, 2, 3] as const).map((intent) => {
                        const r = SCORING.routes.find((x) => x.grades.includes(`${fit}${intent}`))!.route as Route;
                        return (
                          <td key={intent} className="p-0.5">
                            <span
                              title={ROUTE_LABEL[r]}
                              className={`num grid place-items-center w-14 h-8 rounded-[3px] text-[11.5px] ${r === "now" ? "bg-signal text-fg font-semibold" : r === "selfserve" ? "bg-bg-3 text-fg" : "border border-line text-fg-3"}`}
                            >
                              {fit}
                              {intent}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul className="mt-2 flex flex-col gap-1 text-[12px] text-fg-2">
                {SCORING.routes.map((x) => (
                  <li key={x.route}>
                    <span className="font-semibold text-fg">{x.label}</span> ({x.grades}): {x.rule}
                  </li>
                ))}
              </ul>
            </div>
            <p className="lg:col-span-3 text-[12px] text-fg-3">
              The rules live in <code>web/lib/b2b-social-grade.ts</code>. They are hand-set: next, define Fit from closed-won accounts, join with the CRM (customer, open deal, new) and check the
              grades against which people turned into pipeline. Signals fade after {FADE_DAYS} days.
            </p>
          </div>
        )}
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Reach out now" value={inWindow.filter((r) => r.route === "now").length} hint="A1, A2, B1: a rep messages them" tone="accent" />
        <Stat label="Self-serve or startup" value={inWindow.filter((r) => r.route === "selfserve").length} hint="high intent, smaller company" />
        <Stat label="Nurture" value={inWindow.filter((r) => r.route === "nurture").length} hint="right company, no signal yet" />
        <Stat label="Unhappy with a competitor" value={inWindow.filter((r) => r.reason === "switching").length} hint="switching moment" />
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
        columns={[
          { label: "Person" },
          { label: "Company" },
          { label: "Why now" },
          { label: "What they said" },
          { label: "Grade", align: "right", title: "Fit (A-C) × Intent (1-3); see How we score" },
        ]}
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
          <Badge tone={ROUTE_TONE[p.route]}>
            {p.grade} · {ROUTE_LABEL[p.route]}
          </Badge>
          <Badge tone={REASON_TONE[p.reason]}>{OUTREACH_REASON_LABEL[p.reason]}</Badge>
          {p.tierLabel && <Badge tone="green">{p.tierLabel}</Badge>}
          {p.persona !== "unknown" && <Badge>{PERSONA_LABEL[p.persona]}</Badge>}
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
