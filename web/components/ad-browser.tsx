"use client";

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { AD_PAGE_SIZE, activeAdFilterCount, adFiltersHref, applyAdFilters, dimValueLabel, INSIGHT_DIMS, NO_AD_FILTERS, type AdCard, type AdFilters, type AdSort, type AdView } from "@/lib/ad-cards";
import type { TabData } from "@/lib/tab-data";
import { AdGrid, AdPreview, AdTable, PageAvatar, type Favorites } from "@/components/ad-card";
import { GridSkeleton } from "@/components/skeleton";
import { setFavorite } from "@/lib/favorite-actions";
import { useInvalidateProduct } from "@/lib/use-tab";
import {
  ActiveFilters,
  BrowseLayout,
  Chips,
  FilterSection,
  LoadMore,
  MultiSelect,
  NoMatches,
  ResultsBar,
  SearchInput,
  Toggle,
  useFavoriteSet,
  useInfiniteList,
  useUrlState,
  type ActiveFilter,
} from "@/components/controls";

/*
 * Competitor ads browser. The server filters, sorts and sends one page of cards at a time (AD_PAGE_SIZE); the next
 * page loads as you scroll, and the URL follows the filters.
 */

export const AD_SORTS: { key: AdSort; label: string }[] = [
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

export function AdBrowser({
  ads,
  summary,
  slug,
  productId,
  f,
  setF,
  updating,
  hasMore,
  loadMore,
}: {
  /** The pages fetched so far, already filtered and sorted by the server. */
  ads: AdCard[];
  summary: Pick<TabData<"ads">, "matched" | "total" | "advertisers" | "adjacent" | "favCount" | "favorites">;
  slug: string;
  productId: string;
  f: AdFilters;
  setF: Dispatch<SetStateAction<AdFilters>>;
  /** True while `ads` and `summary` are still the previous filters' results. */
  updating: boolean;
  hasMore: boolean;
  loadMore: () => void;
}) {
  const invalidateProduct = useInvalidateProduct();
  const [openId, setOpenId] = useState<string | null>(null);
  const [favs, setFavs] = useFavoriteSet(summary.favorites, async (ids, on) => {
    await setFavorite(productId, "ad", ids, on);
    await invalidateProduct(productId);
  });
  const { matched, advertisers, adjacent, favCount } = summary;
  const isFav = (a: AdCard) => a.memberIds.some((id) => favs.has(id));
  const fav: Favorites<AdCard> = { has: isFav, toggle: (a) => (isFav(a) ? setFavs(a.memberIds, false) : setFavs([a.id], true)) };
  // Until the server answers, keep only the cards already here that match the new filters, so none the filters exclude stay on screen.
  const visible = useMemo(() => (updating ? applyAdFilters(ads, f, Date.now(), favs) : ads), [updating, ads, f, favs]);
  const list = useInfiniteList(updating ? visible.length : matched, AD_PAGE_SIZE);
  useEffect(() => {
    if (!updating && list.limit > ads.length && hasMore) loadMore();
  }, [updating, list.limit, ads.length, hasMore, loadMore]);
  const shown = useMemo(() => visible.slice(0, list.limit), [visible, list.limit]);
  const count = activeAdFilterCount(f);
  useUrlState(adFiltersHref(f));

  const update = (patch: Partial<AdFilters>) => {
    setF((cur) => ({ ...cur, ...patch }));
    list.reset();
  };
  const clear = () => update(NO_AD_FILTERS);

  const advertiserById = new Map(advertisers.map((a) => [a.id, a]));

  const openIndex = openId ? ads.findIndex((a) => a.id === openId) : -1;
  const openAd = openIndex >= 0 ? ads[openIndex]! : null;
  const step = (d: number) => {
    const next = ads[openIndex + d];
    if (!next) return;
    setOpenId(next.id);
    if (openIndex + d + 1 >= list.limit) list.showMore();
  };

  const filters = (
    <>
      {adjacent > 0 && (
        <FilterSection label="Advertiser type" hint="set per page under Ad Library pages">
          <Chips
            items={[
              { key: "", label: "All" },
              { key: "competitor", label: "Direct competitors" },
              { key: "inspiration", label: "Adjacent niches" },
            ]}
            active={f.relation ?? ""}
            onChange={(k) => update({ relation: (k || null) as AdFilters["relation"] })}
          />
        </FilterSection>
      )}
      <FilterSection label="Advertisers">
        <MultiSelect
          allLabel="All advertisers"
          noun="advertisers"
          selected={f.advertisers}
          onChange={(advertisers) => update({ advertisers })}
          summaryIcon={(o) => <PageAvatar url={advertiserById.get(o.value)?.avatar ?? null} name={o.label} size={18} />}
          options={advertisers.map((a) => ({
            value: a.id,
            label: a.name,
            icon: <PageAvatar url={a.avatar} name={a.name} size={28} />,
            detail: `${a.ads} ads · ${a.running} running`,
          }))}
        />
      </FilterSection>
      <FilterSection label="Copy contains">
        <SearchInput value={f.q} onChange={(q) => update({ q })} placeholder="Primary text, headline, link" label="Search ad copy" />
      </FilterSection>
      <FilterSection label="Status">
        <Chips
          items={[
            { key: "", label: "All" },
            { key: "active", label: "Running" },
            { key: "ended", label: "Ended" },
          ]}
          active={f.status ?? ""}
          onChange={(k) => update({ status: (k || null) as AdFilters["status"] })}
        />
      </FilterSection>
      <FilterSection label="Format">
        <Chips
          items={[
            { key: "", label: "All" },
            { key: "video", label: "Video" },
            { key: "image", label: "Image" },
          ]}
          active={f.format ?? ""}
          onChange={(k) => update({ format: (k || null) as AdFilters["format"] })}
        />
      </FilterSection>
      <FilterSection label="Favorites" hint="star an ad to save it">
        <Chips
          items={[
            { key: "", label: "All ads" },
            { key: "1", label: `Favorites only (${favCount})` },
          ]}
          active={f.favorites ? "1" : ""}
          onChange={(k) => update({ favorites: k === "1" })}
        />
      </FilterSection>
      <FilterSection label="Winners" hint="top 10 by impressions, running 21+ days">
        <Chips
          items={[
            { key: "", label: "All ads" },
            { key: "1", label: "Winners only" },
          ]}
          active={f.winners ? "1" : ""}
          onChange={(k) => update({ winners: k === "1" })}
        />
      </FilterSection>
      <FilterSection label="Working" hint="working: 21+ days, top 10 or 5+ versions · early: launched ≤14 days and already top 10">
        <Chips
          items={[
            { key: "", label: "All ads" },
            { key: "working", label: "Working" },
            { key: "early", label: "Early signal" },
          ]}
          active={f.signal ?? ""}
          onChange={(k) => update({ signal: (k || null) as AdFilters["signal"] })}
        />
      </FilterSection>
      <FilterSection label="Launched in the last">
        <Chips
          items={[{ key: "", label: "Any" }, ...LAUNCHED.map((d) => ({ key: String(d), label: `${d}d` }))]}
          active={f.launchedDays ? String(f.launchedDays) : ""}
          onChange={(k) => update({ launchedDays: k ? Number(k) : null })}
        />
      </FilterSection>
      <FilterSection label="Running for at least" hint="longevity ≈ it's working">
        <Chips
          items={[{ key: "", label: "Any" }, ...MIN_DAYS.map((d) => ({ key: String(d), label: `${d}d+` }))]}
          active={f.minDays ? String(f.minDays) : ""}
          onChange={(k) => update({ minDays: k ? Number(k) : null })}
        />
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
    ...(f.signal ? [{ key: "signal", label: f.signal === "working" ? "Working" : "Early signal", remove: () => update({ signal: null }) }] : []),
    ...(f.by && f.v
      ? [
          {
            key: "by",
            label: (
              <>
                <span className="text-fg-3 font-normal">{INSIGHT_DIMS[f.by]}</span> {dimValueLabel(f.by, f.v)}
              </>
            ),
            remove: () => update({ by: null, v: null }),
          },
        ]
      : []),
    ...(f.launchedDays
      ? [
          {
            key: "launched",
            label: (
              <>
                <span className="text-fg-3 font-normal">Launched</span> last {f.launchedDays}d
              </>
            ),
            remove: () => update({ launchedDays: null }),
          },
        ]
      : []),
    ...(f.minDays
      ? [
          {
            key: "mindays",
            label: (
              <>
                <span className="text-fg-3 font-normal">Running</span> {f.minDays}d+
              </>
            ),
            remove: () => update({ minDays: null }),
          },
        ]
      : []),
  ];

  return (
    <BrowseLayout filters={filters} count={count} onReset={clear}>
      <ResultsBar shown={matched} total={summary.total} noun={["ad", "ads"]} updating={updating}>
        <Toggle label="Sort" items={AD_SORTS} active={f.sort} onChange={(sort) => update({ sort })} />
        <Toggle label="View" items={VIEWS} active={f.view} onChange={(view) => setF((cur) => ({ ...cur, view }))} />
      </ResultsBar>
      <ActiveFilters filters={chips} onClear={clear} />
      {shown.length > 0 ? (
        <div aria-busy={updating} className={`transition-opacity duration-150 ${updating ? "opacity-60" : ""}`}>
          {f.view === "table" ? <AdTable ads={shown} slug={slug} onOpen={setOpenId} /> : <AdGrid ads={shown} slug={slug} onOpen={setOpenId} fav={fav} />}
        </div>
      ) : updating ? (
        <GridSkeleton body="cards" />
      ) : (
        <NoMatches onClear={count > 0 ? clear : undefined}>No ads match these filters.</NoMatches>
      )}
      <LoadMore list={list} total={matched} noun="ads" />
      <AdPreview
        ad={openAd}
        slug={slug}
        fav={fav}
        position={openAd ? `${openIndex + 1} / ${matched}` : ""}
        onClose={() => setOpenId(null)}
        onPrev={openIndex > 0 ? () => step(-1) : null}
        onNext={openIndex >= 0 && openIndex < ads.length - 1 ? () => step(1) : null}
      />
    </BrowseLayout>
  );
}
