"use client";

import type { ReactNode } from "react";
import type { OrganicAccount, OrganicPost } from "@/lib/social";
import { fmtAgoShort } from "@/lib/organic-filters";
import { fmtDate } from "@/lib/format";
import { fmtCount, OUTLIER_MIN, platformLabel } from "@/components/social";
import { HoverVideo, Media, MediaTag, PREVIEW_MEDIA, PreviewPane } from "@/components/media";
import { Modal, previewClick } from "@/components/controls";

export function PlatformIcon({ platform, size = 26 }: { platform: string; size?: number }) {
  const bg =
    platform === "instagram" ? "radial-gradient(circle at 30% 107%, #fdf497 0%, #fd5949 45%, #d6249f 60%, #285AEB 90%)"
      : platform === "tiktok" ? "#000" : platform === "facebook" ? "#1877F2" : "var(--fg-3)";
  const glyph =
    platform === "instagram" ? (
      <svg viewBox="0 0 24 24" width="58%" height="58%" fill="none" stroke="#fff" strokeWidth="2.2"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="0.6" fill="#fff" /></svg>
    ) : platform === "tiktok" ? (
      <svg viewBox="0 0 24 24" width="56%" height="56%" fill="#fff"><path d="M12.53.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" /></svg>
    ) : platform === "facebook" ? (
      <svg viewBox="0 0 24 24" width="60%" height="60%" fill="#fff"><path d="M14 8.5V6.8c0-.8.2-1.3 1.4-1.3H17V2.3c-.3 0-1.3-.1-2.4-.1-2.4 0-4 1.4-4 4.1v2.2H8v3.6h2.6V22h3.4v-9.9h2.7l.4-3.6H14z" /></svg>
    ) : null;
  return (
    <span title={platformLabel(platform)} className="inline-flex items-center justify-center rounded-full shrink-0 ring-2 ring-white/80 shadow-sm" style={{ width: size, height: size, background: bg }}>
      {glyph}
    </span>
  );
}

const fmtDuration = (s: number | null) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : null);
const firstLine = (caption: string | null) => caption?.split("\n").map((s) => s.trim()).find(Boolean) ?? null;
export const handleOf = (a: Pick<OrganicAccount, "platform" | "handle" | "displayName">) => (a.platform === "facebook" ? (a.displayName ?? a.handle) : `@${a.handle}`);
export const fmtOutlier = (v: number | null) => (v == null ? "–" : `${v < 10 ? v.toFixed(1) : Math.round(v)}×`);
export const fmtEngagement = (v: number | null) => (v == null ? "–" : `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`);

function MetricPill({ icon, children, tone, title }: { icon: ReactNode; children: ReactNode; tone: "good" | "neutral" | "views" | "eng"; title: string }) {
  const cls = { good: "bg-good-soft text-good", neutral: "bg-bg-3 text-fg-2", views: "bg-pop-4 text-fg", eng: "bg-warn-soft text-warn" }[tone];
  return <span title={title} className={`num inline-flex items-center gap-1 h-6 px-1.5 rounded-[3px] text-[12px] font-medium ${cls}`}>{icon}{children}</span>;
}

const ICON = { width: 13, height: 13, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const TREND = <svg {...ICON}><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></svg>;
const EYE = <svg {...ICON}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>;
const SPARK = <svg {...ICON}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" /></svg>;

export function PostCard({ p, now, onOpen }: { p: OrganicPost; now: number; onOpen: () => void }) {
  const hot = (p.outlier ?? 0) >= OUTLIER_MIN;
  const title = firstLine(p.caption);
  const dur = fmtDuration(p.durationS);
  return (
    <a href={p.url ?? undefined} target="_blank" rel="noreferrer" onClick={(e) => previewClick(e, onOpen)}
      className="group flex flex-col min-w-0 rounded-[6px] focus-visible:outline-offset-4">
      <div className={`relative aspect-[9/16] rounded-[6px] overflow-hidden bg-chrome-3 border transition-[box-shadow,border-color,translate] duration-200 ease-out group-hover:-translate-y-0.5 group-hover:shadow-[0_8px_24px_rgb(0_0_0/0.18)] ${hot ? "border-good" : "border-line"}`}>
        {!p.thumbnailUrl && (
          <div className="absolute inset-0 p-3 flex items-center justify-center text-center text-chrome-fg-2 text-[13px] leading-snug">
            <span className="line-clamp-6">{title ?? "No thumbnail stored"}</span>
          </div>
        )}
        <HoverVideo thumb={p.thumbnailUrl} video={p.videoUrl} />
        <span className="absolute top-2 right-2"><PlatformIcon platform={p.account.platform} /></span>
        {hot && <span className="absolute top-2 left-2"><MediaTag tone="signal">{fmtOutlier(p.outlier)}</MediaTag></span>}
        {dur && <span className="absolute bottom-2 right-2"><MediaTag>{dur}</MediaTag></span>}
      </div>
      <div className="pt-2 px-0.5 min-w-0">
        <div className="font-semibold text-[14px] leading-snug truncate" title={p.caption ?? undefined}>{title ?? "(no caption)"}</div>
        <div className="flex items-center gap-2 text-[12px] text-fg-3 mt-0.5 min-w-0">
          <span className="truncate">{handleOf(p.account)}</span>
          <span className="ml-auto shrink-0" title={p.postedAt ?? undefined}>{fmtAgoShort(p.postedAt, now)}</span>
        </div>
        <div className="flex flex-wrap gap-1 mt-1.5">
          <MetricPill tone={hot ? "good" : "neutral"} title="Outlier: views ÷ the account's median views" icon={TREND}>{fmtOutlier(p.outlier)}</MetricPill>
          <MetricPill tone="views" title="Views" icon={EYE}>{fmtCount(p.views)}</MetricPill>
          <MetricPill tone="eng" title="Engagement: (likes + comments + shares + saves) ÷ views" icon={SPARK}>{fmtEngagement(p.engagement)}</MetricPill>
        </div>
      </div>
    </a>
  );
}

export function PostGrid({ posts, now, onOpen }: { posts: OrganicPost[]; now: number; onOpen: (id: string) => void }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-x-4 gap-y-6">
      {posts.map((p) => <PostCard key={p.id} p={p} now={now} onOpen={() => onOpen(p.id)} />)}
    </div>
  );
}

function Metric({ label, value, tone, wide = false }: { label: string; value: ReactNode; tone?: "good"; wide?: boolean }) {
  return (
    <div className={`min-w-0 ${wide ? "col-span-2" : ""}`}>
      <div className="label">{label}</div>
      <div className={`num text-[17px] font-medium mt-0.5 ${tone === "good" ? "text-good" : ""}`}>{value}</div>
    </div>
  );
}

/** One post in a Modal: the stored video with sound and controls, the full caption and every number. */
export function PostPreview({ post, account, now, position, onClose, onPrev, onNext }: {
  post: OrganicPost | null; account: OrganicAccount | null; now: number; position: string;
  onClose: () => void; onPrev: (() => void) | null; onNext: (() => void) | null;
}) {
  const hot = (post?.outlier ?? 0) >= OUTLIER_MIN;
  const extra = post ? ([["Likes", post.likes], ["Comments", post.comments], ["Shares", post.shares], ["Saves", post.saves]] as const).filter(([, v]) => v != null) : [];
  return (
    <Modal open={!!post} onClose={onClose} onPrev={onPrev} onNext={onNext} position={position} label="Post preview"
      header={post && (
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="relative w-8 h-8 shrink-0">
            <span className="block w-8 h-8 rounded-full overflow-hidden bg-bg-3 border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {account?.avatarUrl && <img src={account.avatarUrl} alt="" className="w-full h-full object-cover" />}
            </span>
            <span className="absolute -bottom-1 -right-1"><PlatformIcon platform={post.account.platform} size={16} /></span>
          </span>
          <div className="min-w-0 leading-tight">
            <div className="font-semibold text-[14px] truncate">{handleOf(post.account)}</div>
            <div className="text-fg-3 text-[12px] truncate">
              {account?.followers != null && <>{fmtCount(account.followers)} followers · </>}
              {account?.medianViews != null && <>median {fmtCount(account.medianViews)} views</>}
            </div>
          </div>
        </div>
      )}>
      {post && (
        <PreviewPane media={<>
          <Media url={post.videoUrl ?? post.thumbnailUrl} type={post.videoUrl ? "video" : "image"} poster={post.thumbnailUrl} controls className={PREVIEW_MEDIA} />
          {!post.videoUrl && post.thumbnailUrl && <span className="absolute bottom-3 left-3 right-3 text-center text-[12px] text-white/80 bg-black/60 rounded-[3px] py-1">Video not stored. Open it on {platformLabel(post.account.platform)}.</span>}
        </>}>
            <div className="grid grid-cols-3 gap-4 px-5 py-4 border-b border-line-2">
              <Metric label="Outlier" value={fmtOutlier(post.outlier)} tone={hot ? "good" : undefined} />
              <Metric label="Views" value={fmtCount(post.views)} />
              <Metric label="Engagement" value={fmtEngagement(post.engagement)} />
              {extra.map(([label, v]) => <Metric key={label} label={label} value={fmtCount(v)} />)}
              {post.durationS != null && <Metric label="Length" value={fmtDuration(post.durationS)} />}
              <Metric wide label="Posted" value={<span className="text-[14px]" title={post.postedAt ?? undefined}>{fmtDate(post.postedAt)} <span className="text-fg-3">· {fmtAgoShort(post.postedAt, now)}</span></span>} />
            </div>
            <div className="px-5 py-4 flex-1 min-h-0 overflow-y-auto">
              <div className="label mb-1.5">Caption</div>
              <p className="text-[14px] leading-relaxed whitespace-pre-line break-words">{post.caption?.trim() || <span className="text-fg-3">(no caption)</span>}</p>
            </div>
            <div className="px-5 py-3 border-t border-line-2 flex items-center gap-2">
              {post.url && <a href={post.url} target="_blank" rel="noreferrer" className="btn btn-primary">Open on {platformLabel(post.account.platform)} ↗</a>}
              {post.videoUrl && <a href={post.videoUrl} download className="btn">Download video</a>}
              <span className="ml-auto text-[12px] text-fg-3 hidden xl:inline whitespace-nowrap">← → browse · Esc close</span>
            </div>
        </PreviewPane>
      )}
    </Modal>
  );
}
