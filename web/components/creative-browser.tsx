"use client";

import { useEffect, useMemo, useState } from "react";
import {
  activeCreativeFilterCount,
  applyCreativeFilters,
  applyScopeFilters,
  creativeFiltersHref,
  GROUP_FIELDS,
  groupItems,
  groupValue,
  labelOf,
  NO_CREATIVE_FILTERS,
  OWNERS,
  type CreativeFilters,
  type CreativeItem,
  type GroupKey,
  type Owner,
} from "@/lib/creative-groups";
import type { ProfileView } from "@/lib/creatives";
import { loadCreativeProfile } from "@/lib/creative-actions";
import { DataTable } from "@/components/data-table";
import { Badge, SectionHead } from "@/components/ui";
import { Media, MediaTag, PREVIEW_MEDIA, PreviewPane } from "@/components/media";
import {
  ActiveFilters,
  BrowseLayout,
  Chips,
  FilterSection,
  LoadMore,
  Modal,
  MultiSelect,
  NoMatches,
  ResultsBar,
  SearchInput,
  Toggle,
  useInfiniteList,
  useUrlState,
  type ActiveFilter,
} from "@/components/controls";

const OWNER_LABEL: Record<Owner, string> = { own: "Ours", competitor: "Competitors", inspiration: "Adjacent niches" };

/*
 * Creatives tab: a breakdown table (count, ours vs competitors, how long competitor media ran) by one profile field,
 * and a grid of every profiled media file. Clicking a breakdown row narrows the grid; clicking a card opens the
 * full AI breakdown, fetched on demand.
 */

const PAGE_SIZE = 48;
const RUN_LABEL = { long: "Ran 30+ days", "90d": "Ran 90+ days", stopped: "Stopped within 14 days", live: "Still live" } as const;

export function CreativeBrowser({ items, initial }: { items: CreativeItem[]; initial: CreativeFilters }) {
  const [f, setF] = useState(initial);
  const [openSha, setOpenSha] = useState<string | null>(null);
  const scoped = useMemo(() => applyScopeFilters(items, f), [items, f]);
  const groups = useMemo(() => groupItems(scoped, f.by), [scoped, f.by]);
  const matched = useMemo(() => applyCreativeFilters(items, f), [items, f]);
  const list = useInfiniteList(matched.length, PAGE_SIZE);
  const shown = useMemo(() => matched.slice(0, list.limit), [matched, list.limit]);
  const count = activeCreativeFilterCount(f);
  useUrlState(creativeFiltersHref(f));

  const update = (patch: Partial<CreativeFilters>) => {
    setF((cur) => ({ ...cur, ...patch }));
    list.reset();
  };
  const clear = () => update(NO_CREATIVE_FILTERS);

  const hasAdjacent = useMemo(() => items.some((it) => it.owner === "inspiration"), [items]);
  const sources = useMemo(() => {
    const by = new Map<string, number>();
    for (const it of items) if (it.owner !== "own") by.set(it.source, (by.get(it.source) ?? 0) + 1);
    return [...by].sort((a, b) => b[1] - a[1]);
  }, [items]);

  const openIndex = openSha ? matched.findIndex((it) => it.sha256 === openSha) : -1;
  const openItem = openIndex >= 0 ? matched[openIndex]! : null;
  const step = (d: number) => {
    const next = matched[openIndex + d];
    if (!next) return;
    setOpenSha(next.sha256);
    if (openIndex + d >= list.limit) list.showMore();
  };

  const filters = (
    <>
      <FilterSection label="Whose ads">
        <Chips
          items={[{ key: "", label: "All" }, ...OWNERS.filter((o) => o !== "inspiration" || hasAdjacent).map((o) => ({ key: o, label: OWNER_LABEL[o] }))]}
          active={f.owner ?? ""}
          onChange={(k) => update({ owner: (k || null) as CreativeFilters["owner"] })}
        />
      </FilterSection>
      <FilterSection label="Advertisers">
        <MultiSelect
          allLabel="All advertisers"
          noun="advertisers"
          selected={f.sources}
          onChange={(s) => update({ sources: s })}
          options={sources.map(([name, n]) => ({ value: name, label: name, detail: `${n} creatives` }))}
        />
      </FilterSection>
      <FilterSection label="Hook or advertiser contains">
        <SearchInput value={f.q} onChange={(q) => update({ q })} placeholder="Spoken or on-screen hook" label="Search hooks" />
      </FilterSection>
      <FilterSection label="Competitor run length" hint="running long ≈ it works">
        <Chips
          items={[
            { key: "", label: "Any" },
            { key: "long", label: "30+ days" },
            { key: "90d", label: "90+ days" },
            { key: "stopped", label: "Stopped fast" },
            { key: "live", label: "Live" },
          ]}
          active={f.run ?? ""}
          onChange={(k) => update({ run: (k || null) as CreativeFilters["run"] })}
        />
      </FilterSection>
    </>
  );

  const chips: ActiveFilter[] = [
    ...(f.owner ? [{ key: "owner", label: OWNER_LABEL[f.owner], remove: () => update({ owner: null }) }] : []),
    ...f.sources.map((s) => ({ key: `src:${s}`, label: s, remove: () => update({ sources: f.sources.filter((x) => x !== s) }) })),
    ...(f.q ? [{ key: "q", label: <>“{f.q}”</>, remove: () => update({ q: "" }) }] : []),
    ...(f.run ? [{ key: "run", label: RUN_LABEL[f.run], remove: () => update({ run: null }) }] : []),
    ...(f.value
      ? [
          {
            key: "v",
            label: (
              <>
                <span className="text-fg-3 font-normal">{GROUP_FIELDS[f.by].label}</span> {labelOf(f.value)}
              </>
            ),
            remove: () => update({ value: null }),
          },
        ]
      : []),
  ];

  return (
    <BrowseLayout filters={filters} count={count} onReset={clear}>
      <SectionHead right={<span className="text-xs text-fg-3">Click a row to narrow the grid · % ran long = ran 30+ d ÷ (30+ d + stopped within 14)</span>}>Breakdown</SectionHead>
      <div className="mb-3">
        <Toggle
          size="sm"
          label="Group by"
          active={f.by}
          onChange={(by: GroupKey) => update({ by, value: null })}
          items={(Object.keys(GROUP_FIELDS) as GroupKey[]).map((key) => ({ key, label: GROUP_FIELDS[key].label }))}
        />
      </div>
      <DataTable
        dense
        maxHeight="360px"
        className="mb-6"
        columns={[
          { label: GROUP_FIELDS[f.by].label },
          { label: "Creatives", align: "right" },
          { label: "Ours", align: "right" },
          { label: "Competitors", align: "right" },
          ...(hasAdjacent ? [{ label: "Adjacent", align: "right" as const }] : []),
          { label: "Ran 30+ d", align: "right" },
          { label: "Stopped <14 d", align: "right" },
          { label: "% ran long", align: "right" },
        ]}
        defaultSort={{ col: 1, dir: "desc" }}
        rows={groups.map((g) => {
          const decided = g.long + g.stopped;
          const active = g.value === f.value;
          return {
            id: `${f.by}:${g.value}`,
            onClick: () => update({ value: active ? null : g.value }),
            className: active ? "!bg-accent-soft" : "",
            cells: [
              { node: <span className={`font-medium ${active ? "text-accent" : ""}`}>{labelOf(g.value)}</span>, value: labelOf(g.value) },
              { node: g.total, value: g.total },
              { node: g.own || "–", value: g.own, dim: !g.own },
              { node: g.competitor || "–", value: g.competitor, dim: !g.competitor },
              ...(hasAdjacent ? [{ node: g.inspiration || "–", value: g.inspiration, dim: !g.inspiration }] : []),
              { node: g.long || "–", value: g.long, dim: !g.long },
              { node: g.stopped || "–", value: g.stopped, dim: !g.stopped },
              { node: decided ? `${Math.round((g.long / decided) * 100)}%` : "–", value: decided ? g.long / decided : null, dim: !decided },
            ],
          };
        })}
      />

      <ResultsBar shown={matched.length} total={items.length} noun={["creative", "creatives"]} />
      <ActiveFilters filters={chips} onClear={clear} />
      {shown.length === 0 ? (
        <NoMatches onClear={count > 0 ? clear : undefined}>No creatives match these filters.</NoMatches>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-x-4 gap-y-6">
          {shown.map((it) => (
            <CreativeTile key={it.sha256} item={it} by={f.by} onOpen={() => setOpenSha(it.sha256)} />
          ))}
        </div>
      )}
      <LoadMore list={list} total={matched.length} noun="creatives" />
      <CreativePreview
        item={openItem}
        position={openItem ? `${openIndex + 1} / ${matched.length}` : ""}
        onClose={() => setOpenSha(null)}
        onPrev={openIndex > 0 ? () => step(-1) : null}
        onNext={openIndex >= 0 && openIndex < matched.length - 1 ? () => step(1) : null}
      />
    </BrowseLayout>
  );
}

const CreativeMedia = ({ item, controls, className }: { item: CreativeItem; controls?: boolean; className?: string }) => (
  <Media url={item.url} type={item.mediaType} controls={controls} className={className} />
);

/** Tile tags truncate inside the column instead of spilling over the next tile. */
const TAG = "max-w-full truncate h-5 leading-5 px-1.5 rounded-[3px] text-[11.5px] font-medium";
const hookText = (it: CreativeItem) => it.hook.spoken ?? it.hook.onscreen;
const angleLabel = (it: CreativeItem) => (it.fields.angle === "other" ? `Other: ${labelOf(it.fields.angle_suggestion)}` : labelOf(it.fields.angle));

function CreativeTile({ item, by, onOpen }: { item: CreativeItem; by: GroupKey; onOpen: () => void }) {
  const hook = hookText(item);
  const second = by === "angle" ? item.fields.hook_type && `${labelOf(item.fields.hook_type)} hook` : labelOf(groupValue(item, by));
  return (
    <button type="button" onClick={onOpen} className="group flex flex-col min-w-0 text-left rounded-[6px] focus-visible:outline-offset-4">
      <div
        className={`relative aspect-[9/16] w-full rounded-[6px] overflow-hidden border transition-[box-shadow,border-color,translate] duration-200 ease-out group-hover:-translate-y-0.5 group-hover:shadow-[0_8px_24px_rgb(0_0_0/0.18)] ${item.bucket === "long" ? "border-good" : "border-line"}`}
      >
        <CreativeMedia item={item} className="absolute inset-0 w-full h-full" />
        <div className="absolute top-2 left-2 flex flex-wrap gap-1">
          {item.owner === "own" && <MediaTag tone="signal">Ours</MediaTag>}
          {item.owner === "inspiration" && <MediaTag title="Adjacent niche, tracked for inspiration">Adjacent</MediaTag>}
          {item.bucket === "long" && <MediaTag tone="good">{item.days}d</MediaTag>}
          {item.bucket === "stopped" && <MediaTag>stopped {item.days}d</MediaTag>}
        </div>
        {item.active && (
          <span className="absolute top-2 right-2">
            <MediaTag dot>live</MediaTag>
          </span>
        )}
      </div>
      <div className="pt-2 px-0.5 min-w-0">
        <div className="text-[12px] text-fg-3 truncate">
          {item.source}
          {item.bucket === "mid" && item.days != null ? ` · ${item.days}d` : ""}
        </div>
        <div className="font-semibold text-[13.5px] leading-snug line-clamp-2 mt-0.5">{hook ? `“${hook}”` : <span className="text-fg-3 font-normal">{item.hook.visual ?? "No hook text"}</span>}</div>
        <div className="flex flex-col items-start gap-1 mt-1.5 min-w-0">
          <span className={`${TAG} text-accent bg-accent-soft`}>{angleLabel(item)}</span>
          {second && second !== "–" && <span className={`${TAG} text-fg-2 bg-bg-3 border border-line`}>{second}</span>}
        </div>
      </div>
    </button>
  );
}

function CreativePreview({ item, position, onClose, onPrev, onNext }: { item: CreativeItem | null; position: string; onClose: () => void; onPrev: (() => void) | null; onNext: (() => void) | null }) {
  const [profile, setProfile] = useState<{ sha: string; p: ProfileView | null } | null>(null);
  useEffect(() => {
    if (!item || profile?.sha === item.sha256) return;
    let live = true;
    loadCreativeProfile(item.sha256)
      .then((p) => {
        if (live) setProfile({ sha: item.sha256, p });
      })
      .catch(() => {
        if (live) setProfile({ sha: item.sha256, p: null });
      });
    return () => {
      live = false;
    };
  }, [item, profile?.sha]);
  const p = profile && profile.sha === item?.sha256 ? profile.p : undefined;
  const s = p?.strategy;
  const rows: [string, string | null | undefined][] = s
    ? [
        ["Mechanism", s.mechanism],
        ["Identity", s.identity],
        ["Persona", s.audience && labelOf(s.audience)],
        ["Claim type", s.claim_type && labelOf(s.claim_type)],
        ["Pain points", s.pain_points.map(labelOf).join(", ")],
        ["Desires", s.desires.map(labelOf).join(", ")],
        ["Features", s.features.map(labelOf).join(", ")],
        ["Proof", s.proof.map(labelOf).join(", ")],
        ["People", p!.people.map((x) => [x.role, x.gender, x.age_band?.replace("_", "–"), x.ethnicity].filter(Boolean).join(" · ")).join("; ")],
      ]
    : [];
  return (
    <Modal
      open={!!item}
      onClose={onClose}
      onPrev={onPrev}
      onNext={onNext}
      position={position}
      label="Creative breakdown"
      header={
        item && (
          <div className="min-w-0 leading-tight">
            <div className="font-semibold text-[14px] truncate">{item.source}</div>
            <div className="text-[12px] text-fg-3">
              {item.owner === "own" ? "Our creative" : item.days != null ? `Ran ${item.days} days${item.active ? " · still live" : ""}` : "Competitor creative"}
            </div>
          </div>
        )
      }
    >
      {item && (
        <PreviewPane media={<CreativeMedia key={item.sha256} item={item} controls className={PREVIEW_MEDIA} />}>
          <div className="flex-1 min-w-0 overflow-y-auto px-5 py-4 flex flex-col gap-4">
            <div>
              <div className="label mb-1">Hook</div>
              <p className="text-[16px] font-semibold leading-snug">{hookText(item) ? `“${hookText(item)}”` : (item.hook.visual ?? "–")}</p>
              {item.hook.spoken && item.hook.onscreen && <p className="text-[13px] text-fg-2 mt-1">On screen: {item.hook.onscreen}</p>}
              {item.hook.visual && hookText(item) && <p className="text-[13px] text-fg-3 mt-1">Shows: {item.hook.visual}</p>}
            </div>
            <div className="flex flex-wrap gap-1">
              <Badge tone="accent">{angleLabel(item)}</Badge>
              {(["hook", "audience", "awareness", "response", "format", "style", "structure"] as GroupKey[]).map((k) => {
                const v = GROUP_FIELDS[k].get(item.fields);
                return v ? (
                  <Badge key={k}>
                    <span className="text-fg-3 mr-1">{GROUP_FIELDS[k].label}:</span>
                    {labelOf(v)}
                  </Badge>
                ) : null;
              })}
            </div>
            {p === undefined ? (
              <div className="flex flex-col gap-2" aria-busy="true">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-3.5 rounded-[3px] bg-line-2 animate-pulse" style={{ width: `${90 - i * 15}%` }} />
                ))}
              </div>
            ) : p === null ? (
              <p className="text-[13px] text-fg-3">The full breakdown couldn't be loaded.</p>
            ) : (
              <>
                <dl className="grid grid-cols-[100px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
                  {rows
                    .filter(([, v]) => v)
                    .map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-fg-3">{k}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                </dl>
                {p.script?.transcript && (
                  <div>
                    <div className="label mb-1">Transcript</div>
                    <p className="text-[13px] leading-relaxed whitespace-pre-line text-fg-2">{p.script.transcript}</p>
                  </div>
                )}
              </>
            )}
          </div>
        </PreviewPane>
      )}
    </Modal>
  );
}
