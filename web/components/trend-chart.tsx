import type { WeekLine } from "@/lib/overview";

const W = 640;
const H = 200;
const PAD = { top: 22, right: 8, bottom: 26, left: 8 };

const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const dollars = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** Ad spend against proceeds per week, as paired bars with their amounts on top. */
export function TrendChart({ weeks }: { weeks: WeekLine[] }) {
  if (!weeks.length) return null;
  const max = Math.max(1, ...weeks.flatMap((w) => [w.spend, w.proceeds]));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const group = innerW / weeks.length;
  const bar = Math.min(56, group * 0.32);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const series = [
    { key: "spend", label: "Ad spend", fill: "var(--line)", text: "var(--fg-3)" },
    { key: "proceeds", label: "Proceeds", fill: "var(--good)", text: "var(--good)" },
  ] as const;
  return (
    <div>
      <div className="flex gap-4 text-[12px] text-fg-3 mb-1">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-[2px]" style={{ background: s.fill }} />
            {s.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Weekly ad spend and proceeds">
        <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} stroke="var(--line)" strokeWidth={1} />
        {weeks.map((w, i) => {
          const cx = PAD.left + group * i + group / 2;
          return (
            <g key={w.from}>
              {series.map((s, j) => {
                const v = w[s.key];
                const x = cx + (j === 0 ? -bar - 2 : 2);
                return (
                  <g key={s.key}>
                    <rect x={x} y={y(v)} width={bar} height={y(0) - y(v)} fill={s.fill} rx={2} />
                    <text x={x + bar / 2} y={y(v) - 6} textAnchor="middle" fontSize={11} fill={s.text} fontFamily="var(--font-mono)">
                      {dollars(v)}
                    </text>
                  </g>
                );
              })}
              <text x={cx} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--fg-3)" fontFamily="var(--font-mono)">
                {shortDate(w.from)} – {shortDate(w.to)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
