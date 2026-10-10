"use client";

import { useRef, type ReactNode } from "react";

/*
 * Media building blocks shared by every grid and preview (organic posts, competitor ads, creatives): a still or
 * video that never autoplays in a grid, hover-to-play for thumbnails, the two-pane preview layout used inside
 * Modal, and the small tags that sit on top of media. /ui shows them.
 */

/**
 * An image or video. In grids (no `controls`) a video shows its first frame and loads only metadata; with
 * `controls` it plays with sound. No URL renders a dark "no media" block of the same size.
 */
export function Media({ url, type, poster, controls = false, className = "", empty = "No media stored" }: {
  url: string | null; type: "image" | "video" | string; poster?: string | null; controls?: boolean; className?: string; empty?: ReactNode;
}) {
  if (!url) return <div className={`grid place-items-center text-chrome-fg-3 text-[12px] bg-chrome-3 ${className}`}>{empty}</div>;
  if (type === "image") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" loading="lazy" className={`object-cover bg-chrome-3 ${className}`} />;
  }
  return controls
    ? <video key={url} src={url} poster={poster ?? undefined} controls autoPlay playsInline className={`object-cover bg-black ${className}`} />
    : <video src={poster ? url : `${url}#t=0.5`} poster={poster ?? undefined} preload={poster ? "none" : "metadata"} muted playsInline className={`object-cover bg-black ${className}`} />;
}

/** Thumbnail that plays the stored video (muted) while the pointer is over its `group` card. */
export function HoverVideo({ thumb, video }: { thumb: string | null; video: string | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  const play = () => {
    const v = ref.current;
    if (!v) return;
    v.currentTime = 0;
    v.play().catch(() => {});
  };
  return (
    <div className="absolute inset-0" onMouseEnter={video ? play : undefined} onMouseLeave={video ? () => ref.current?.pause() : undefined}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {thumb && <img src={thumb} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />}
      {video && (
        <video ref={ref} src={video} poster={thumb ?? undefined} muted loop playsInline preload="none"
          className="absolute inset-0 w-full h-full object-cover opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
      )}
    </div>
  );
}

/** Classes for Media filling the left pane of PreviewPane. */
export const PREVIEW_MEDIA = "w-full h-full max-h-[55dvh] md:max-h-none !object-contain";

/** Modal body: media on the left (black), details on the right; stacks on phones. */
export function PreviewPane({ media, children }: { media: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col md:flex-row md:h-[min(760px,calc(100dvh-72px))]">
      <div className="relative bg-black md:w-[min(440px,46%)] shrink-0 flex items-center justify-center">{media}</div>
      <div className="flex-1 min-w-0 flex flex-col min-h-0">{children}</div>
    </div>
  );
}

const TAG_TONE = { signal: "bg-signal text-fg font-semibold", dark: "bg-black/65 text-white", good: "bg-good text-white" } as const;

/** Small label on top of media: "Winner", "174d", "3 versions", "live". */
export function MediaTag({ tone = "dark", dot = false, children, title }: { tone?: keyof typeof TAG_TONE; dot?: boolean; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`num h-5 px-1.5 rounded-[3px] text-[11px] inline-flex items-center gap-1 ${TAG_TONE[tone]}`}>
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-good" />}
      {children}
    </span>
  );
}
