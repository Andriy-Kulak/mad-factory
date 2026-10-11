"use client";

import { useMemo, useState } from "react";
import type { OrganicAccount, OrganicPost, OrganicSort } from "@/lib/social";
import { activeFilterCount, applyOrganicFilters, NO_FILTERS, organicHref, PAGE_SIZE, parseNum, sortPosts, type AgeUnit, type OrganicFilters, type OrganicView, type Range } from "@/lib/organic-filters";
import { fmtCount, platformLabel, PostTable } from "@/components/social";
import { handleOf, PlatformIcon, PostGrid, PostPreview } from "@/components/post-grid";
import type { Favorites } from "@/components/ad-card";
import { setFavorite } from "@/lib/favorite-actions";
import { ActiveFilters, BrowseLayout, Chips, DraftInput, FilterSection, LoadMore, MultiSelect, NoMatches, RangeFilter, ResultsBar, SearchInput, Toggle, useFavoriteSet, useInfiniteList, useUrlState, type ActiveFilter } from "@/components/controls";

/*
 * The Organic tab's post browser. Every stored post arrives once from the server; filtering, sorting and paging run
 * here so each change is instant, and the URL follows along so a filtered view can be shared.
 */

const SORTS: { key: OrganicSort; label: string }[] = [
  { key: "outlier", label: "Outliers" },
  { key: "views", label: "Most views" },
  { key: "engagement", label: "Engagement" },
  { key: "newest", label: "Newest" },
];
const VIEWS: { key: OrganicView; label: string }[] = [
  { key: "grid", label: "Grid" },
  { key: "table", label: "Table" },
];
const UNIT_LABEL: Record<AgeUnit, string> = { days: "day", weeks: "week", months: "month" };
const AGE_PRESETS: { label: string; n: number; unit: AgeUnit }[] = [
  { label: "7d", n: 7, unit: "days" },
  { label: "30d", n: 30, unit: "days" },
  { label: "3mo", n: 3, unit: "months" },
  { label: "6mo", n: 6, unit: "months" },
  { label: "1y", n: 12, unit: "months" },
];

const fmtX = (v: number) => `${v}×`;
const fmtPct = (v: number) => `${v}%`;
const rangeText = (r: Range, f: (v: number) => string) =>
  r.min != null && r.max != null ? `${f(r.min)}–${f(r.max)}` : r.min != null ? `${f(r.min)}+` : r.max != null ? `≤ ${f(r.max)}` : "";
const ageText = (a: { n: number; unit: AgeUnit }) => `${a.n} ${UNIT_LABEL[a.unit]}${a.n === 1 ? "" : "s"}`;
const ageKey = (a: { n: number; unit: AgeUnit }) => `${a.n}-${a.unit}`;

function Avatar({ a, size = 28 }: { a: OrganicAccount; size?: number }) {
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      <span className="block w-full h-full rounded-full overflow-hidden bg-bg-3 border border-line">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {a.avatarUrl && <img src={a.avatarUrl} alt="" loading="lazy" className="w-full h-full object-cover" />}
      </span>
      <span className="absolute -bottom-1 -right-1"><PlatformIcon platform={a.platform} size={Math.round(size / 2)} /></span>
    </span>
  );
}

export function OrganicBrowser({ posts, accounts, productId, favoriteIds, initial, now }: {
  posts: OrganicPost[]; accounts: OrganicAccount[]; productId: string; favoriteIds: string[]; initial: OrganicFilters; now: number;
}) {
  const [f, setF] = useState(initial);
  const [openId, setOpenId] = useState<string | null>(null);
  const [favs, setFavs] = useFavoriteSet(favoriteIds, (ids, on) => setFavorite(productId, "post", ids, on));
  // The favorites filter uses the set as of when it was applied, so unstarring a post doesn't make it vanish mid-browse.
  const [filterFavs, setFilterFavs] = useState(favs);
  const matched = useMemo(() => sortPosts(applyOrganicFilters(posts, f, now, filterFavs), f.sort), [posts, f, now, filterFavs]);
  const fav: Favorites<OrganicPost> = { has: (p) => favs.has(p.id), toggle: (p) => setFavs([p.id], !favs.has(p.id)) };
  const favCount = useMemo(() => posts.filter((p) => favs.has(p.id)).length, [posts, favs]);
  const list = useInfiniteList(matched.length, PAGE_SIZE);
  const shown = useMemo(() => matched.slice(0, list.limit), [matched, list.limit]);
  const count = activeFilterCount(f);
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  useUrlState(organicHref(f));

  const update = (patch: Partial<OrganicFilters>) => {
    setF((cur) => ({ ...cur, ...patch }));
    setFilterFavs(favs);
    list.reset();
  };
  const clear = () => update(NO_FILTERS);

  const openIndex = openId ? matched.findIndex((p) => p.id === openId) : -1;
  const openPost = openIndex >= 0 ? matched[openIndex]! : null;
  const step = (d: number) => {
    const next = matched[openIndex + d];
    if (!next) return;
    setOpenId(next.id);
    if (openIndex + d >= list.limit) list.showMore();
  };

  const platforms = [...new Set(accounts.map((a) => a.platform))];
  const customAge = f.postedWithin && !AGE_PRESETS.some((p) => ageKey(p) === ageKey(f.postedWithin!));

  const filters = (
    <>
      <FilterSection label="Channels">
        <MultiSelect allLabel="All channels" noun="channels" selected={f.channels} onChange={(channels) => update({ channels })}
          summaryIcon={(o) => <PlatformIcon platform={accountById.get(o.value)?.platform ?? ""} size={16} />}
          options={accounts.map((a) => ({
            value: a.id, label: handleOf(a), keywords: `${a.displayName ?? ""} ${a.label ?? ""}`,
            icon: <Avatar a={a} />, detail: `${a.postsTracked} posts · ${fmtCount(a.followers)} followers`,
          }))} />
      </FilterSection>
      <FilterSection label="Favorites" hint="star a post to save it">
        <Chips items={[{ key: "", label: "All posts" }, { key: "1", label: `Favorites only (${favCount})` }]} active={f.favorites ? "1" : ""} onChange={(k) => update({ favorites: k === "1" })} />
      </FilterSection>
      <FilterSection label="Caption contains">
        <SearchInput value={f.q} onChange={(q) => update({ q })} placeholder="Search captions" label="Search captions" />
      </FilterSection>
      {platforms.length > 1 && (
        <FilterSection label="Platform">
          <Chips items={[{ key: "", label: "All" }, ...platforms.map((p) => ({ key: p, label: platformLabel(p) }))]} active={f.platform ?? ""} onChange={(p) => update({ platform: p || null })} />
        </FilterSection>
      )}
      <FilterSection label="Outlier score" hint="views ÷ the account's median">
        <RangeFilter label="Outlier score" value={f.outlier} onChange={(outlier) => update({ outlier })} presets={[2, 3, 10, 30]} fmt={fmtX} parse={parseNum} placeholder={["min ×", "max ×"]} />
      </FilterSection>
      <FilterSection label="Views">
        <RangeFilter label="Views" value={f.views} onChange={(views) => update({ views })} presets={[10_000, 100_000, 1_000_000]} fmt={(v) => fmtCount(v)} parse={parseNum} placeholder={["min, e.g. 50k", "max"]} />
      </FilterSection>
      <FilterSection label="Engagement">
        <RangeFilter label="Engagement" value={f.engagement} onChange={(engagement) => update({ engagement })} presets={[2, 5, 10]} fmt={fmtPct} parse={parseNum} placeholder={["min %", "max %"]} />
      </FilterSection>
      <FilterSection label="Posted in the last">
        <Chips
          items={[{ key: "", label: "Any" }, ...AGE_PRESETS.map((p) => ({ key: ageKey(p), label: p.label })), ...(customAge ? [{ key: ageKey(f.postedWithin!), label: ageText(f.postedWithin!) }] : [])]}
          active={f.postedWithin ? ageKey(f.postedWithin) : ""}
          onChange={(k) => {
            const p = AGE_PRESETS.find((x) => ageKey(x) === k);
            update({ postedWithin: p ? { n: p.n, unit: p.unit } : k ? f.postedWithin : null });
          }} />
        <div className="flex gap-2 mt-2">
          <DraftInput value={f.postedWithin ? String(f.postedWithin.n) : ""} parse={parseNum} placeholder="Custom" inputMode="numeric" aria-label="Posted in the last (number)" className="control w-full min-w-0"
            onCommit={(s) => {
              const n = parseNum(s);
              update({ postedWithin: n && n > 0 ? { n: Math.floor(n), unit: f.postedWithin?.unit ?? "days" } : null });
            }} />
          <select value={f.postedWithin?.unit ?? "days"} aria-label="Unit" className="control w-full min-w-0"
            onChange={(e) => f.postedWithin && update({ postedWithin: { ...f.postedWithin, unit: e.target.value as AgeUnit } })}>
            <option value="days">Days</option>
            <option value="weeks">Weeks</option>
            <option value="months">Months</option>
          </select>
        </div>
      </FilterSection>
    </>
  );

  const chips: ActiveFilter[] = [
    ...(f.favorites ? [{ key: "fav", label: "Favorites", remove: () => update({ favorites: false }) }] : []),
    ...f.channels.map((id) => {
      const a = accountById.get(id);
      return { key: `ch:${id}`, label: a ? <><PlatformIcon platform={a.platform} size={14} />{handleOf(a)}</> : "Unknown channel", remove: () => update({ channels: f.channels.filter((c) => c !== id) }) };
    }),
    ...(f.q ? [{ key: "q", label: <>“{f.q}”</>, remove: () => update({ q: "" }) }] : []),
    ...(f.platform ? [{ key: "platform", label: platformLabel(f.platform), remove: () => update({ platform: null }) }] : []),
    ...([["outlier", "Outlier", fmtX], ["views", "Views", (v: number) => fmtCount(v)], ["engagement", "Engagement", fmtPct]] as const).flatMap(([key, name, fmt]) => {
      const t = rangeText(f[key], fmt);
      return t ? [{ key, label: <><span className="text-fg-3 font-normal">{name}</span> {t}</>, remove: () => update({ [key]: { min: null, max: null } }) }] : [];
    }),
    ...(f.postedWithin ? [{ key: "age", label: <><span className="text-fg-3 font-normal">Last</span> {ageText(f.postedWithin)}</>, remove: () => update({ postedWithin: null }) }] : []),
  ];

  return (
    <BrowseLayout filters={filters} count={count} onReset={clear}>
      <ResultsBar shown={matched.length} total={posts.length} noun={["post", "posts"]}>
        <Toggle label="Sort" items={SORTS} active={f.sort} onChange={(sort) => update({ sort })} />
        <Toggle label="View" items={VIEWS} active={f.view} onChange={(view) => setF((cur) => ({ ...cur, view }))} />
      </ResultsBar>
      <ActiveFilters filters={chips} onClear={clear} />
      {shown.length === 0 ? (
        <NoMatches onClear={count > 0 ? clear : undefined}>No posts match these filters.</NoMatches>
      ) : f.view === "table" ? (
        <PostTable posts={shown} />
      ) : (
        <PostGrid posts={shown} now={now} onOpen={setOpenId} fav={fav} />
      )}
      <LoadMore list={list} total={matched.length} noun="posts" />
      <PostPreview
        post={openPost}
        fav={fav}
        account={openPost ? (accountById.get(openPost.account.id) ?? null) : null}
        now={now}
        position={openPost ? `${openIndex + 1} / ${matched.length}` : ""}
        onClose={() => setOpenId(null)}
        onPrev={openIndex > 0 ? () => step(-1) : null}
        onNext={openIndex >= 0 && openIndex < matched.length - 1 ? () => step(1) : null}
      />
    </BrowseLayout>
  );
}
