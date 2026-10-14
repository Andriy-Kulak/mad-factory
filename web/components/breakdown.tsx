"use client";

import { useEffect, useState } from "react";
import type { ProfileView } from "@/lib/creatives";
import { labelOf } from "@/lib/creative-groups";

const cache = new Map<string, ProfileView | null>();

/** "Breakdown" block in a preview: hook type, hook line, angle, audience and format from the media's creative profile. */
export function Breakdown({ id, load }: { id: string | null; load: (id: string) => Promise<ProfileView | null> }) {
  const [state, setState] = useState<{ id: string; profile: ProfileView | null } | null>(() => (id && cache.has(id) ? { id, profile: cache.get(id)! } : null));
  useEffect(() => {
    if (!id) return;
    if (cache.has(id)) return setState({ id, profile: cache.get(id)! });
    let live = true;
    setState(null);
    load(id).then(
      (profile) => {
        // Only a found profile is cached: a starred item gets one a minute later, and reopening should show it.
        if (profile) cache.set(id, profile);
        if (live) setState({ id, profile });
      },
      () => live && setState({ id, profile: null }),
    );
    return () => {
      live = false;
    };
  }, [id, load]);
  if (!id) return null;
  const p = state?.id === id ? state.profile : undefined;
  if (p === undefined) return <div className="label">Breakdown…</div>;
  if (!p) return <p className="text-[12.5px] text-fg-3">No breakdown yet. Starring it makes one (hook type, transcript, angle) in about a minute.</p>;
  const hook = p.hook.spoken ?? p.hook.onscreen_text;
  const rows: [string, string | null][] = [
    ["Hook type", p.hook.type],
    ["Angle", p.strategy.angle ?? p.strategy.angle_suggestion ?? null],
    ["Audience", p.strategy.audience],
    ["Awareness", p.strategy.awareness],
    ["Format", p.production.format],
    ["Structure", p.script?.structure ?? null],
  ];
  return (
    <div>
      <div className="label mb-1.5">Breakdown</div>
      {hook && <p className="text-[14px] font-semibold leading-snug mb-1">“{hook}”</p>}
      {p.hook.visual && <p className="text-[12.5px] text-fg-3 mb-2">Shows: {p.hook.visual}</p>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-fg-3">{k}</dt>
              <dd>{labelOf(v)}</dd>
            </div>
          ))}
      </dl>
    </div>
  );
}
