"use client";

import { useMemo, useState } from "react";
import { activeAdFilterCount, adFiltersHref, applyAdFilters, NO_AD_FILTERS, sortAdCards, type AdCard, type AdFilters, type AdSort, type AdView } from "@/lib/ad-cards";
import { AdGrid, AdPreview, AdTable, PageAvatar, type Favorites } from "@/components/ad-card";
import { setFavorite } from "@/lib/favorite-actions";
import { ActiveFilters, BrowseLayout, Chips, FilterSection, LoadMore, MultiSelect, NoMatches, ResultsBar, SearchInput, Toggle, useFavoriteSet, useInfiniteList, useUrlState, type ActiveFilter } from "@/components/controls";

/*
 * Competitor ads browser. Every tracked ad arrives once from the server as a card; filters and sorts run here so
 * changes are instant, and the URL follows along.
 */

const SORTS: { key: AdSort; label: string }[] = [
  { key: "impressions", label: "Top impressions" },
  { key: "newest", label: "Newest" },
  { key: "longest", label: "Longest running" },
  { key: "variants", label: "Most versions" },
];
const VIEWS: { key: AdView; label: string }[] = [
  { key: "cards", label: "Cards" },
  { key: "table", label: "Table" },
];
const LAUNCHED = [7, 30, 90];
const MIN_DAYS = [7, 30, 90];
const PAGE_SIZE = 36;

export function AdBrowser({ ads, slug, productId, favoriteIds, initial }: { ads: AdCard[]; slug: string; productId: string; favoriteIds: string[]; initial: AdFilters }) {
  const [f, setF] = useState(initial);
  const [openId, setOpenId] = useState<string | null>(null);
  const [favs, setFavs] = useFavoriteSet(favoriteIds, (ids, on) => setFavorite(productId, "ad", ids, on));
  // The favorites filter uses the set as of when it was applied, so unstarring a card doesn't make it vanish mid-browse.
  const [filterFavs, setFilterFavs] = useState(favs);
  const matched = useMemo(() => sortAdCards(applyAdFilters(ads, f, Date.now(), filterFavs), f.sort), [ads, f, filterFavs]);
  const isFav = (a: AdCard) => a.memberIds.some((id) => favs.has(id));
  const fav: Favorites<AdCard> = { has: isFav, toggle: (a) => (isFav(a) ? setFavs(a.memberIds, false) : setFavs([a.id], true)) };
  const favCount = useMemo(() => ads.filter((a) => a.memberIds.some((id) => favs.has(id))).length, [ads, favs]);
  const list = useInfiniteList(matched.length, PAGE_SIZE);
  const shown = useMemo(() => matched.slice(0, list.limit), [matched, list.limit]);
  const count = activeAdFilterCount(f);
  useUrlState(adFiltersHref(f));

  const update = (patch: Partial<AdFilters>) => {
    setF((cur) => ({ ...cur, ...patch }));
    setFilterFavs(favs);
    list.reset();
  };
  const clear = () => update(NO_AD_FILTERS);

  const advertisers = useMemo(() => {
    const by = new Map<string, { id: string; name: string; avatar: string | null; ads: number; running: number }>();
    for (const a of ads) {
      const id = a.advertiserId ?? "";
      const cur = by.get(id) ?? { id, name: a.advertiserName ?? "Unknown advertiser", avatar: a.avatarUrl, ads: 0, running: 0 };
      cur.ads++;
      if (a.isActive) cur.running++;
      by.set(id, cur);
    }
    return [...by.values()].sort((x, y) => y.ads - x.ads);
  }, [ads]);
  const advertiserById = new Map(advertisers.map((a) => [a.id, a]));
  const adjacent = useMemo(() => ads.filter((a) => a.relation === "inspiration").length, [ads]);

  const openIndex = openId ? matched.findIndex((a) => a.id === openId) : -1;
  const openAd = openIndex >= 0 ? matched[openIndex]! : null;
  const step = (d: number) => {
    const next = matched[openIndex + d];
    if (!next) return;
    setOpenId(next.id);
    if (openIndex + d >= list.limit) list.showMore();
  };

  const filters = (
    <>
      {adjacent > 0 && (
        <FilterSection label="Advertiser type" hint="set per page under Ad Library pages">
          <Chips items={[{ key: "", label: "All" }, { key: "competitor", label: "Direct competitors" }, { key: "inspiration", label: "Adjacent niches" }]} active={f.relation ?? ""}
            onChange={(k) => update({ relation: (k || null) as AdFilters["relation"] })} />
        </FilterSection>
      )}
      <FilterSection label="Advertisers">
        <MultiSelect allLabel="All advertisers" noun="advertisers" selected={f.advertisers} onChange={(advertisers) => update({ advertisers })}
          summaryIcon={(o) => <PageAvatar url={advertiserById.get(o.value)?.avatar ?? null} name={o.label} size={18} />}
          options={advertisers.map((a) => ({
            value: a.id, label: a.name, icon: <PageAvatar url={a.avatar} name={a.name} size={28} />,
            detail: `${a.ads} ads · ${a.running} running`,
          }))} />
      </FilterSection>
      <FilterSection label="Copy contains">
        <SearchInput value={f.q} onChange={(q) => update({ q })} placeholder="Primary text, headline, link" label="Search ad copy" />
      </FilterSection>
      <FilterSection label="Status">
        <Chips items={[{ key: "", label: "All" }, { key: "active", label: "Running" }, { key: "ended", label: "Ended" }]} active={f.status ?? ""}
          onChange={(k) => update({ status: (k || null) as AdFilters["status"] })} />
      </FilterSection>
      <FilterSection label="Format">
        <Chips items={[{ key: "", label: "All" }, { key: "video", label: "Video" }, { key: "image", label: "Image" }]} active={f.format ?? ""}
          onChange={(k) => update({ format: (k || null) as AdFilters["format"] })} />
      </FilterSection>
      <FilterSection label="Favorites" hint="star an ad to save it">
        <Chips items={[{ key: "", label: "All ads" }, { key: "1", label: `Favorites only (${favCount})` }]} active={f.favorites ? "1" : ""} onChange={(k) => update({ favorites: k === "1" })} />
      </FilterSection>
      <FilterSection label="Winners" hint="top 10 by impressions, running 21+ days">
        <Chips items={[{ key: "", label: "All ads" }, { key: "1", label: "Winners only" }]} active={f.winners ? "1" : ""} onChange={(k) => update({ winners: k === "1" })} />
      </FilterSection>
      <FilterSection label="Launched in the last">
        <Chips items={[{ key: "", label: "Any" }, ...LAUNCHED.map((d) => ({ key: String(d), label: `${d}d` }))]} active={f.launchedDays ? String(f.launchedDays) : ""}
          onChange={(k) => update({ launchedDays: k ? Number(k) : null })} />
      </FilterSection>
      <FilterSection label="Running for at least" hint="longevity ≈ it's working">
        <Chips items={[{ key: "", label: "Any" }, ...MIN_DAYS.map((d) => ({ key: String(d), label: `${d}d+` }))]} active={f.minDays ? String(f.minDays) : ""}
          onChange={(k) => update({ minDays: k ? Number(k) : null })} />
      </FilterSection>
    </>
  );

  const chips: ActiveFilter[] = [
    ...(f.favorites ? [{ key: "fav", label: "Favorites", remove: () => update({ favorites: false }) }] : []),
    ...(f.relation ? [{ key: "rel", label: f.relation === "competitor" ? "Direct competitors" : "Adjacent niches", remove: () => update({ relation: null }) }] : []),
    ...f.advertisers.map((id) => ({ key: `adv:${id}`, label: advertiserById.get(id)?.name ?? "Unknown advertiser", remove: () => update({ advertisers: f.advertisers.filter((a) => a !== id) }) })),
    ...(f.q ? [{ key: "q", label: <>“{f.q}”</>, remove: () => update({ q: "" }) }] : []),
    ...(f.status ? [{ key: "status", label: f.status === "active" ? "Running" : "Ended", remove: () => update({ status: null }) }] : []),
    ...(f.format ? [{ key: "format", label: f.format === "video" ? "Video" : "Image", remove: () => update({ format: null }) }] : []),
    ...(f.winners ? [{ key: "winners", label: "Winners", remove: () => update({ winners: false }) }] : []),
    ...(f.launchedDays ? [{ key: "launched", label: <><span className="text-fg-3 font-normal">Launched</span> last {f.launchedDays}d</>, remove: () => update({ launchedDays: null }) }] : []),
    ...(f.minDays ? [{ key: "mindays", label: <><span className="text-fg-3 font-normal">Running</span> {f.minDays}d+</>, remove: () => update({ minDays: null }) }] : []),
  ];

  return (
    <BrowseLayout filters={filters} count={count} onReset={clear}>
      <ResultsBar shown={matched.length} total={ads.length} noun={["ad", "ads"]}>
        <Toggle label="Sort" items={SORTS} active={f.sort} onChange={(sort) => update({ sort })} />
        <Toggle label="View" items={VIEWS} active={f.view} onChange={(view) => setF((cur) => ({ ...cur, view }))} />
      </ResultsBar>
      <ActiveFilters filters={chips} onClear={clear} />
      {shown.length === 0 ? (
        <NoMatches onClear={count > 0 ? clear : undefined}>No ads match these filters.</NoMatches>
      ) : f.view === "table" ? (
        <AdTable ads={shown} slug={slug} onOpen={setOpenId} />
      ) : (
        <AdGrid ads={shown} slug={slug} onOpen={setOpenId} fav={fav} />
      )}
      <LoadMore list={list} total={matched.length} noun="ads" />
      <AdPreview ad={openAd} slug={slug} fav={fav} position={openAd ? `${openIndex + 1} / ${matched.length}` : ""}
        onClose={() => setOpenId(null)}
        onPrev={openIndex > 0 ? () => step(-1) : null}
        onNext={openIndex >= 0 && openIndex < matched.length - 1 ? () => step(1) : null} />
    </BrowseLayout>
  );
}
