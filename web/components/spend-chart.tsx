"use client";

import { useState } from "react";

export interface DayPoint {
  date: string;
  spend: number;
  impressions: number;
  taps: number;
  installs: number;
  trials?: number;
}

const W = 640;
const H = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 48 };

/** Round the axis maximum up to 1, 2, 2.5 or 5 times a power of ten. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((n) => n >= v)!;
}

const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Daily spend as a single-series line with a crosshair tooltip. One axis: spend. */
export function SpendChart({ days, tapsLabel = "taps" }: { days: DayPoint[]; tapsLabel?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!days.length) return <p className="text-fg-3 text-[13px]">No activity in this range.</p>;

  const max = niceMax(Math.max(...days.map((d) => d.spend)));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (days.length === 1 ? innerW / 2 : (i * innerW) / (days.length - 1));
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const line = days.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.spend).toFixed(1)}`).join("");
  const area = `${line}L${x(days.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const labelEvery = Math.ceil(days.length / 7);
  const h = hover == null ? null : days[hover]!;
  const band = days.length === 1 ? innerW : innerW / (days.length - 1);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Daily spend, ${days[0]!.date} to ${days[days.length - 1]!.date}`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--fg-3)" fontFamily="var(--font-mono)">${t.toFixed(max < 10 ? 2 : 0)}</text>
          </g>
        ))}
        {days.map((d, i) =>
          // Regular ticks, plus the last day unless it would sit on top of the previous tick.
          (i % labelEvery === 0 && days.length - 1 - i >= labelEvery) || i === days.length - 1 ? (
            <text key={d.date} x={x(i)} y={H - 8} textAnchor={i === days.length - 1 ? "end" : i === 0 ? "start" : "middle"} fontSize={11} fill="var(--fg-3)" fontFamily="var(--font-mono)">{shortDate(d.date)}</text>
          ) : null,
        )}
        <path d={area} fill="var(--accent)" opacity={0.08} />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {days.length <= 31 && days.map((d, i) => <circle key={d.date} cx={x(i)} cy={y(d.spend)} r={hover === i ? 5 : 3} fill="var(--accent)" stroke="var(--bg-2)" strokeWidth={2} />)}
        {h && hover != null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={y(0)} stroke="var(--fg-3)" strokeWidth={1} strokeDasharray="3 3" />
            {days.length > 31 && <circle cx={x(hover)} cy={y(h.spend)} r={5} fill="var(--accent)" stroke="var(--bg-2)" strokeWidth={2} />}
          </>
        )}
        {/* Hit targets: one full-height band per day, wider than the mark. */}
        {days.map((d, i) => (
          <rect key={d.date} x={x(i) - band / 2} y={0} width={band} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      {h && hover != null && (
        <div
          className="card absolute pointer-events-none px-3 py-2 text-xs num whitespace-nowrap z-10"
          style={{ top: 4, left: `${(x(hover) / W) * 100}%`, transform: `translateX(${x(hover) > W / 2 ? "calc(-100% - 10px)" : "10px"})` }}
        >
          <div className="text-fg-3">{shortDate(h.date)}</div>
          <div className="text-[15px] font-medium text-fg">${h.spend.toFixed(2)}</div>
          <div className="text-fg-2">{h.impressions.toLocaleString("en-US")} impr · {h.taps} {tapsLabel} · {h.installs} installs</div>
        </div>
      )}
    </div>
  );
}
