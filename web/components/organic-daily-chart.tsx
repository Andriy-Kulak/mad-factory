"use client";

import { useState } from "react";

export interface OrganicDay {
  date: string;
  posts: number;
  /** Latest stored views of the posts published that day. */
  views: number;
}

const W = 1100;
const H = 260;
const PAD = { top: 16, right: 44, bottom: 26, left: 52 };
const POSTS_COLOR = "var(--warn)";

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((n) => n >= v)!;
}

/** Monotone cubic (Fritsch–Carlson) path: smooth, and never overshoots below zero or above a peak. */
function smoothPath(pts: [number, number][]): string {
  const n = pts.length;
  if (n < 3) return pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join("");
  const dx = pts.slice(1).map(([px], i) => px - pts[i]![0]);
  const slope = pts.slice(1).map(([, py], i) => (py - pts[i]![1]) / dx[i]!);
  const m = pts.map((_, i) => (i === 0 ? slope[0]! : i === n - 1 ? slope[n - 2]! : slope[i - 1]! * slope[i]! <= 0 ? 0 : (slope[i - 1]! + slope[i]!) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / slope[i]!;
    const b = m[i + 1]! / slope[i]!;
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * slope[i]!;
      m[i + 1] = t * b * slope[i]!;
    }
  }
  let d = `M${pts[0]![0].toFixed(1)},${pts[0]![1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[i + 1]!;
    const h = dx[i]! / 3;
    d += `C${(x0 + h).toFixed(1)},${(y0 + m[i]! * h).toFixed(1)} ${(x1 - h).toFixed(1)},${(y1 - m[i + 1]! * h).toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}

const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : String(n));

/** Views (by publish day, left axis) and posts per day (right axis) as two smooth lines on one date axis. */
export function OrganicDailyChart({ days }: { days: OrganicDay[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!days.length) return <p className="text-fg-3 text-[13px]">No dated reels or videos yet.</p>;

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const viewsMax = niceMax(Math.max(...days.map((d) => d.views)));
  const postsMax = Math.max(2, Math.ceil(Math.max(...days.map((d) => d.posts)) / 2) * 2);
  const x = (i: number) => PAD.left + (days.length === 1 ? innerW / 2 : (i * innerW) / (days.length - 1));
  const yViews = (v: number) => PAD.top + innerH - (v / viewsMax) * innerH;
  const yPosts = (v: number) => PAD.top + innerH - (v / postsMax) * innerH;
  const views = smoothPath(days.map((d, i) => [x(i), yViews(d.views)]));
  const posts = smoothPath(days.map((d, i) => [x(i), yPosts(d.posts)]));
  const area = `${views}L${x(days.length - 1).toFixed(1)},${yViews(0)}L${x(0).toFixed(1)},${yViews(0)}Z`;
  const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1];
  const labelEvery = Math.ceil(days.length / 8);
  const band = days.length === 1 ? innerW : innerW / (days.length - 1);
  const h = hover == null ? null : days[hover]!;

  return (
    <div className="relative">
      <div className="flex items-center gap-4 text-xs text-fg-2 mb-2">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-[3px] rounded-full bg-accent" />
          Views
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-[3px] rounded-full" style={{ background: POSTS_COLOR }} />
          Posts (right axis)
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Posts and views by day, ${days[0]!.date} to ${days.at(-1)!.date}`} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="organic-views-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={yViews(t * viewsMax)} y2={yViews(t * viewsMax)} stroke="var(--line-2)" strokeWidth={1} />
            <text x={PAD.left - 8} y={yViews(t * viewsMax) + 4} textAnchor="end" fontSize={11} fill="var(--fg-3)" fontFamily="var(--font-mono)">
              {compact(t * viewsMax)}
            </text>
          </g>
        ))}
        {[0, postsMax / 2, postsMax].map((v) => (
          <text key={v} x={W - PAD.right + 8} y={yPosts(v) + 4} textAnchor="start" fontSize={11} fill={POSTS_COLOR} fontFamily="var(--font-mono)">
            {v}
          </text>
        ))}
        {days.map((d, i) =>
          (i % labelEvery === 0 && days.length - 1 - i >= labelEvery) || i === days.length - 1 ? (
            <text key={d.date} x={x(i)} y={H - 6} textAnchor={i === days.length - 1 ? "end" : i === 0 ? "start" : "middle"} fontSize={11} fill="var(--fg-3)" fontFamily="var(--font-mono)">
              {shortDate(d.date)}
            </text>
          ) : null,
        )}
        <path d={area} fill="url(#organic-views-fill)" />
        <path d={posts} fill="none" stroke={POSTS_COLOR} strokeWidth={1.75} strokeDasharray="5 4" strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
        <path d={views} fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {h && hover != null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={yViews(0)} stroke="var(--fg-3)" strokeWidth={1} strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={yPosts(h.posts)} r={4} fill={POSTS_COLOR} stroke="var(--bg-2)" strokeWidth={2} />
            <circle cx={x(hover)} cy={yViews(h.views)} r={5} fill="var(--accent)" stroke="var(--bg-2)" strokeWidth={2} />
          </>
        )}
        {days.map((d, i) => (
          <rect key={d.date} x={x(i) - band / 2} y={0} width={band} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      {h && hover != null && (
        <div
          className="card absolute pointer-events-none px-3 py-2 text-xs num whitespace-nowrap z-10"
          style={{ top: 28, left: `${(x(hover) / W) * 100}%`, transform: `translateX(${x(hover) > W / 2 ? "calc(-100% - 10px)" : "10px"})` }}
        >
          <div className="text-fg-3">{shortDate(h.date)}</div>
          <div className="text-[15px] font-medium text-fg">{h.views.toLocaleString("en-US")} views</div>
          <div style={{ color: POSTS_COLOR }}>
            {h.posts} {h.posts === 1 ? "post" : "posts"}
          </div>
        </div>
      )}
    </div>
  );
}
