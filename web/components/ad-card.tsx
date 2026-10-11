"use client";

import Link from "next/link";
import { useState } from "react";
import { cleanText, hookOf, mediaFormat, type AdCard } from "@/lib/ad-cards";
import { fmtDate } from "@/lib/format";
import { Badge } from "@/components/ui";
import { Modal, previewClick } from "@/components/controls";
import { FavoriteStar, Media, MediaTag, PREVIEW_MEDIA, PreviewPane } from "@/components/media";
import { Transcript } from "@/components/transcript";
import { loadMediaTranscript } from "@/lib/transcript-actions";

/*
 * Competitor ads drawn the way they look in the feed: page, run dates, primary text, media, then the link bar with
 * the headline and CTA. AdTile is the grid card, AdTableRow the dense list, AdPreview the full ad in a Modal.
 */

/** Page avatar from the Ad Library (its links expire), falling back to the page's initial. */
export function PageAvatar({ url, name, size = 32 }: { url: string | null; name: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const initial = (name ?? "?").trim().charAt(0).toUpperCase();
  return (
    <span className="shrink-0 rounded-full overflow-hidden bg-chrome text-signal grid place-items-center font-semibold border border-line" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {url && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="w-full h-full object-cover" />
      ) : (
        initial
      )}
    </span>
  );
}

const shortDate = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** "● Jul 12 – Present · 88d" with a lit dot while the ad runs. */
export function RunDates({ ad }: { ad: Pick<AdCard, "startDate" | "endDate" | "isActive" | "days"> }) {
  if (!ad.startDate) return <span className="text-fg-3 text-[12px]">Start date unknown</span>;
  const end = ad.isActive ? "Present" : ad.endDate ? shortDate(ad.endDate) : "ended";
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-fg-2 min-w-0" title={`Started ${fmtDate(ad.startDate)}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ad.isActive ? "bg-good" : "bg-fg-3"}`} />
      <span className="truncate">
        {shortDate(ad.startDate)} – {end}
      </span>
      {ad.days != null && <span className="num text-fg-3 shrink-0">· {ad.days}d</span>}
    </span>
  );
}

/** Ad Library impressions rank with its move since the previous scrape. */
export function RankBadge({ rank, compact = false }: { rank: AdCard["rank"]; compact?: boolean }) {
  if (!rank) return compact ? <span className="num text-fg-3">–</span> : null;
  const move = rank.prevRank == null ? null : rank.prevRank - rank.rank;
  return (
    <span
      title="Position in the advertiser's latest Ad Library scrape, sorted by total impressions"
      className={`num inline-flex items-center gap-1 font-medium ${compact ? "" : "h-6 px-1.5 rounded-[3px] bg-bg-3 border border-line text-[12px]"}`}
    >
      #{rank.rank}
      {move != null && move > 0 && <span className="text-good text-[11px]">▲{move}</span>}
      {move != null && move < 0 && <span className="text-danger text-[11px]">▼{-move}</span>}
    </span>
  );
}

const AdMedia = ({ ad, controls, className }: { ad: AdCard; controls?: boolean; className?: string }) => (
  <Media url={ad.media?.url ?? null} type={ad.media?.type === "image" ? "image" : "video"} controls={controls} className={className} />
);

/** Link bar under the media: display link, headline, CTA button. */
function LinkBar({ ad }: { ad: AdCard }) {
  const title = cleanText(ad.title);
  if (!ad.caption && !title && !ad.cta) return null;
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 bg-bg-3 border-t border-line-2">
      <div className="min-w-0 flex-1">
        {ad.caption && <div className="text-[11px] uppercase tracking-wide text-fg-3 truncate">{ad.caption}</div>}
        {title && <div className="text-[13px] font-semibold leading-snug truncate">{title}</div>}
      </div>
      {ad.cta && <span className="shrink-0 h-7 px-2.5 rounded-[3px] bg-line-2 border border-line text-[12px] font-semibold inline-flex items-center">{ad.cta}</span>}
    </div>
  );
}

/** Favorite state for cards and previews; absent where starring isn't offered. */
export interface Favorites<T> {
  has: (item: T) => boolean;
  toggle: (item: T) => void;
}

export function AdTile({ ad, href, onOpen, fav }: { ad: AdCard; href: string; onOpen: () => void; fav?: Favorites<AdCard> }) {
  const body = cleanText(ad.body);
  return (
    <a
      href={href}
      onClick={(e) => previewClick(e, onOpen)}
      className={`group card overflow-hidden flex flex-col min-w-0 transition-[box-shadow,border-color,translate] duration-200 ease-out hover:-translate-y-0.5 hover:border-fg-3 hover:shadow-[0_8px_24px_rgb(0_0_0/0.12)] ${ad.isActive === false ? "opacity-70 hover:opacity-100" : ""}`}
    >
      <div className="flex items-center gap-2.5 px-3 pt-3">
        <PageAvatar url={ad.avatarUrl} name={ad.advertiserName} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="font-semibold text-[13.5px] truncate">{ad.advertiserName ?? "Unknown advertiser"}</div>
          <RunDates ad={ad} />
        </div>
        <RankBadge rank={ad.rank} />
      </div>
      <div className="px-3 pt-2 pb-2.5">
        <p className="text-[13px] leading-snug text-fg-2 line-clamp-2 min-h-[2lh]">{body ?? hookOf(ad)}</p>
      </div>
      <div className="relative">
        <AdMedia ad={ad} className="w-full aspect-[4/5]" />
        <div className="absolute top-2 left-2 flex gap-1">
          {ad.winner && <MediaTag tone="signal">Winner</MediaTag>}
          {ad.relation === "inspiration" && <MediaTag title="Adjacent niche, tracked for inspiration">Adjacent</MediaTag>}
          {ad.versions > 1 && <MediaTag title="Ads using this creative">{ad.versions} versions</MediaTag>}
        </div>
        {fav && (
          <span className="absolute top-2 right-2">
            <FavoriteStar on={fav.has(ad)} onToggle={() => fav.toggle(ad)} />
          </span>
        )}
        {mediaFormat(ad) === "video" && (
          <span className="absolute inset-0 grid place-items-center pointer-events-none">
            <span className="w-11 h-11 rounded-full bg-black/45 grid place-items-center transition-transform duration-200 group-hover:scale-110">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </span>
        )}
      </div>
      <LinkBar ad={ad} />
    </a>
  );
}

export function AdGrid({ ads, slug, onOpen, fav }: { ads: AdCard[]; slug: string; onOpen: (id: string) => void; fav?: Favorites<AdCard> }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
      {ads.map((ad) => (
        <AdTile key={ad.id} ad={ad} href={`/p/${slug}/ads/${ad.id}`} onOpen={() => onOpen(ad.id)} fav={fav} />
      ))}
    </div>
  );
}

const COLS = "grid grid-cols-[32px_44px_minmax(200px,1fr)_160px_72px_170px_64px] gap-3 items-center px-4 min-w-[860px]";

export function AdTable({ ads, slug, onOpen }: { ads: AdCard[]; slug: string; onOpen: (id: string) => void }) {
  return (
    <div className="card overflow-x-auto">
      <div className={`${COLS} label h-10 border-b border-line`}>
        <div>#</div>
        <div></div>
        <div>Hook</div>
        <div>Advertiser</div>
        <div className="text-right" title="Position in the advertiser's latest Ad Library scrape sorted by total impressions">
          Imp. rank
        </div>
        <div>Running</div>
        <div className="text-right">Versions</div>
      </div>
      {ads.map((ad, i) => (
        <a
          key={ad.id}
          href={`/p/${slug}/ads/${ad.id}`}
          onClick={(e) => previewClick(e, () => onOpen(ad.id))}
          className={`${COLS} row-link py-2 border-b border-line-2 last:border-b-0 ${ad.isActive === false ? "opacity-60" : ""}`}
        >
          <div className="num text-fg-3">{i + 1}</div>
          <AdMedia ad={ad} className="w-12 aspect-[4/5] rounded-[2px]" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-semibold truncate">{hookOf(ad)}</span>
              {ad.winner && <Badge tone="green">winner</Badge>}
            </div>
            <div className="text-fg-3 text-xs truncate mt-0.5">{[ad.cta, ad.caption].filter(Boolean).join(" · ")}</div>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <PageAvatar url={ad.avatarUrl} name={ad.advertiserName} size={22} />
            <span className="truncate text-fg-2">{ad.advertiserName ?? "Unknown"}</span>
          </div>
          <div className="text-right">
            <RankBadge rank={ad.rank} compact />
          </div>
          <RunDates ad={ad} />
          <div className="num text-right text-fg-2">{ad.versions}</div>
        </a>
      ))}
    </div>
  );
}

export function AdPreview({
  ad,
  slug,
  position,
  onClose,
  onPrev,
  onNext,
  fav,
}: {
  ad: AdCard | null;
  slug: string;
  position: string;
  onClose: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  fav?: Favorites<AdCard>;
}) {
  const body = ad ? cleanText(ad.body) : null;
  return (
    <Modal
      open={!!ad}
      onClose={onClose}
      onPrev={onPrev}
      onNext={onNext}
      position={position}
      label="Ad preview"
      header={
        ad && (
          <div className="flex items-center gap-2.5 min-w-0">
            <PageAvatar url={ad.avatarUrl} name={ad.advertiserName} size={30} />
            <div className="min-w-0 leading-tight">
              <div className="font-semibold text-[14px] truncate">{ad.advertiserName ?? "Unknown advertiser"}</div>
              <RunDates ad={ad} />
            </div>
          </div>
        )
      }
    >
      {ad && (
        <PreviewPane media={<AdMedia key={ad.id} ad={ad} controls className={PREVIEW_MEDIA} />}>
          <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-line-2">
            <RankBadge rank={ad.rank} />
            {ad.winner && <Badge tone="green">winner</Badge>}
            <Badge tone={ad.isActive ? "green" : "neutral"}>{ad.isActive ? "running" : ad.isActive === false ? "ended" : "unknown"}</Badge>
            {ad.versions > 1 && <Badge>{ad.versions} versions</Badge>}
            {ad.platforms.length > 0 && <span className="text-[12px] text-fg-3 ml-auto">{ad.platforms.map((p) => p.toLowerCase()).join(" · ")}</span>}
          </div>
          <div className="px-5 py-4 flex-1 min-h-0 overflow-y-auto flex flex-col gap-4">
            <div>
              <div className="label mb-1.5">Primary text</div>
              <p className="text-[14px] leading-relaxed whitespace-pre-line break-words">{body ?? <span className="text-fg-3">(no primary text)</span>}</p>
            </div>
            <div className="card overflow-hidden">
              <LinkBar ad={ad} />
            </div>
            {mediaFormat(ad) !== "image" && <Transcript id={ad.media?.sha256 ?? null} load={loadMediaTranscript} />}
            {ad.linkUrl && (
              <div className="text-[12px] text-fg-3 break-all">
                Links to{" "}
                <a href={ad.linkUrl} target="_blank" rel="noreferrer" title={ad.linkUrl} className="text-fg-2 hover:text-fg underline underline-offset-2">
                  {ad.linkUrl.split("?")[0]}
                </a>
              </div>
            )}
          </div>
          <div className="px-5 py-3 border-t border-line-2 flex items-center gap-2">
            <a href={`https://www.facebook.com/ads/library/?id=${encodeURIComponent(ad.externalId)}`} target="_blank" rel="noreferrer" className="btn btn-primary">
              Ad Library ↗
            </a>
            {fav && <FavoriteStar variant="button" on={fav.has(ad)} onToggle={() => fav.toggle(ad)} />}
            <Link href={`/p/${slug}/ads/${ad.id}`} className="btn">
              Full details
            </Link>
            {ad.media && (
              <a href={ad.media.url} download className="btn">
                Download {ad.media.type === "image" ? "image" : "video"}
              </a>
            )}
            <span className="ml-auto text-[12px] text-fg-3 hidden xl:inline whitespace-nowrap">← → browse · Esc close</span>
          </div>
        </PreviewPane>
      )}
    </Modal>
  );
}
