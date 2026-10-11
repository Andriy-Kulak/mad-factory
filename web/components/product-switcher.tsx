"use client";

import { useRouter } from "next/navigation";
import type { ProductRow } from "@db/types";

/** Native select over a styled face; `compact` shows only the initial (collapsed sidebar). */
export function ProductSwitcher({ products, current, compact = false }: { products: Pick<ProductRow, "slug" | "name">[]; current: Pick<ProductRow, "slug" | "name">; compact?: boolean }) {
  const router = useRouter();
  const initial = current.name.trim().charAt(0).toUpperCase() || "?";
  return (
    <label className="relative flex items-center gap-3 w-full h-10 pl-2 pr-2 rounded-[3px] border border-chrome-line bg-chrome-2 text-chrome-fg cursor-pointer transition-colors duration-200 ease-out hover:border-chrome-fg-3 focus-within:border-signal overflow-hidden">
      <span className="w-6 h-6 shrink-0 rounded-[3px] bg-signal text-chrome grid place-items-center text-[12px] font-bold">{initial}</span>
      <span className={`flex-1 min-w-0 truncate text-[13px] font-medium transition-opacity duration-150 ${compact ? "opacity-0" : "opacity-100 delay-100"}`}>{current.name}</span>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className={`shrink-0 text-chrome-fg-3 transition-opacity duration-150 ${compact ? "opacity-0" : "opacity-100 delay-100"}`}
        aria-hidden="true"
      >
        <path d="M8 9l4-4 4 4M8 15l4 4 4-4" />
      </svg>
      <select aria-label="Switch product" value={current.slug} onChange={(e) => router.push(`/p/${e.target.value}`)} className="absolute inset-0 opacity-0 cursor-pointer">
        {products.map((p) => (
          <option key={p.slug} value={p.slug}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}
