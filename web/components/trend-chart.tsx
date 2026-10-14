import type { WeekLine } from "@/lib/overview";

const W = 640;
const H = 200;
const PAD = { top: 22, right: 8, bottom: 26, left: 8 };

const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const dollars = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** Weekly ad spend stacked by channel against proceeds per week. */
export function TrendChart({ weeks, channelLabels }: { weeks: WeekLine[]; channelLabels: Record<string, string> }) {
  if (!weeks.length) return null;
  const channelOrder = (channel: string) => (channel === "meta_ads" ? 0 : channel === "apple_ads" ? 1 : 2);
  const channels = Object.keys(weeks[0]!.spendByChannel).sort((a, b) => channelOrder(a) - channelOrder(b) || a.localeCompare(b));
  const channelFill = (channel: string) => (channel === "meta_ads" ? "var(--fg-2)" : channel === "apple_ads" ? "var(--warn)" : "var(--fg-3)");
  const max = Math.max(1, ...weeks.flatMap((w) => [w.spend, w.proceeds]));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const group = innerW / weeks.length;
  const bar = Math.min(56, group * 0.32);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  return (
    <div>
      <div className="flex gap-4 text-[12px] text-fg-3 mb-1">
        {channels.map((channel) => (
          <span key={channel} className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-[2px]" style={{ background: channelFill(channel) }} />
            {channelLabels[channel] ?? channel}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-[2px]" style={{ background: "var(--good)" }} />
          Proceeds
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Weekly ad spend by channel and proceeds">
        <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} stroke="var(--line)" strokeWidth={1} />
        {weeks.map((w, i) => {
          const cx = PAD.left + group * i + group / 2;
          const spendX = cx - bar - 2;
          let stacked = 0;
          return (
            <g key={w.from}>
              {channels.map((channel) => {
                const amount = w.spendByChannel[channel] ?? 0;
                const bottom = y(stacked);
                stacked += amount;
                const top = y(stacked);
                const height = bottom - top;
                return (
                  <g key={channel}>
                    <rect x={spendX} y={top} width={bar} height={height} fill={channelFill(channel)} rx={2}>
                      <title>{`${channelLabels[channel] ?? channel}: ${dollars(amount)}`}</title>
                    </rect>
                    {amount !== 0 && (
                      <text
                        x={height >= 16 ? spendX + bar / 2 : spendX - 4}
                        y={top + height / 2 + 4}
                        textAnchor={height >= 16 ? "middle" : "end"}
                        fontSize={11}
                        fill={height >= 16 ? "#fff" : "var(--fg)"}
                        fontFamily="var(--font-mono)"
                      >
                        {dollars(amount)}
                      </text>
                    )}
                  </g>
                );
              })}
              <text x={spendX + bar / 2} y={y(w.spend) - 6} textAnchor="middle" fontSize={11} fill="var(--fg-3)" fontFamily="var(--font-mono)">
                {dollars(w.spend)}
              </text>
              <rect x={cx + 2} y={y(w.proceeds)} width={bar} height={y(0) - y(w.proceeds)} fill="var(--good)" rx={2} />
              <text x={cx + 2 + bar / 2} y={y(w.proceeds) - 6} textAnchor="middle" fontSize={11} fill="var(--good)" fontFamily="var(--font-mono)">
                {dollars(w.proceeds)}
              </text>
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
