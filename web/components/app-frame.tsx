"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { ProductRow } from "@db/types";
import { ProductSwitcher } from "./product-switcher";
import { activeNav, NAV_GROUPS, NAV_ITEMS, PRODUCT_COOKIE, SIDEBAR_COOKIE, type NavItem, type NavKey } from "./nav";

type Product = Pick<ProductRow, "slug" | "name">;

function Icon({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <path d={d} />
    </svg>
  );
}

/**
 * Dark top bar + collapsible sidebar around the light workspace. Lives in the product layout so it keeps
 * its state across page navigations; the collapsed state is a cookie so the server renders the right width.
 */
export function AppFrame({ products, current, defaultCollapsed, user, needsSetup = [], children }: { products: Product[]; current: Product; defaultCollapsed: boolean; user?: string | null; needsSetup?: NavKey[]; children: ReactNode }) {
  const pathname = usePathname();
  const active = activeNav(pathname, current.slug);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      document.cookie = `${SIDEBAR_COOKIE}=${c ? "0" : "1"}; path=/; max-age=31536000; samesite=lax`;
      return !c;
    });
  }, []);

  useEffect(() => {
    document.cookie = `${PRODUCT_COOKIE}=${encodeURIComponent(current.slug)}; path=/; max-age=31536000; samesite=lax`;
  }, [current.slug]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "b" || e.altKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar current={current} active={active} products={products} user={user} />
      <PhoneNav slug={current.slug} active={active} />
      <div className="flex-1 flex items-start">
        <Sidebar products={products} current={current} active={active} collapsed={collapsed} onToggle={toggle} needsSetup={needsSetup} />
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  );
}

function TopBar({ current, active, products, user }: { current: Product; active: NavItem; products: Product[]; user?: string | null }) {
  return (
    <div className="sticky top-0 z-30 h-12 shrink-0 flex items-center gap-3 px-4 bg-chrome border-b border-chrome-line text-[13px] text-chrome-fg-2">
      <Link href={`/p/${current.slug}`} className="font-semibold text-chrome-fg hover:text-signal transition-colors duration-200">mad-factory</Link>
      <span className="hidden sm:flex items-center gap-2 min-w-0">
        <span className="text-chrome-fg-3">/</span>
        <span className="truncate">{current.name}</span>
        <span className="text-chrome-fg-3">/</span>
        <span className="truncate text-chrome-fg">{active.label}</span>
      </span>
      <div className="lg:hidden ml-auto w-44">
        <ProductSwitcher products={products} current={current} />
      </div>
      <Link href="/setup" className="hidden lg:inline ml-auto hover:text-chrome-fg transition-colors duration-200">Setup</Link>
      <Link href="/ui" className="hidden lg:inline hover:text-chrome-fg transition-colors duration-200">Components</Link>
      {user && (
        <form action="/api/auth/logout" method="post" className="flex items-center gap-3 shrink-0">
          <span aria-hidden="true" className="hidden lg:block h-4 w-px bg-chrome-line" />
          <span className="hidden lg:inline">@{user}</span>
          <button type="submit" className="hover:text-chrome-fg transition-colors duration-200">Sign out</button>
        </form>
      )}
    </div>
  );
}

function PhoneNav({ slug, active }: { slug: string; active: NavItem }) {
  return (
    <nav aria-label="Sections" className="lg:hidden sticky top-12 z-20 flex gap-1 overflow-x-auto px-3 py-2 bg-chrome border-b border-chrome-line text-[13px]">
      {NAV_ITEMS.map((it) => (
        <Link
          key={it.key}
          href={`/p/${slug}${it.path}`}
          aria-current={it.key === active.key ? "page" : undefined}
          className={`h-8 px-3 flex items-center rounded-[3px] whitespace-nowrap transition-colors duration-200 ${it.key === active.key ? "bg-chrome-3 text-signal" : "text-chrome-fg-2 hover:text-chrome-fg"}`}
        >
          {it.label}
        </Link>
      ))}
    </nav>
  );
}

const EXPANDED = 232;
const COLLAPSED = 64;

/** Channels the product has not connected stay in the sidebar, dimmed and marked "set up", so they are easy to find. */
function Sidebar({ products, current, active, collapsed, onToggle, needsSetup }: { products: Product[]; current: Product; active: NavItem; collapsed: boolean; onToggle: () => void; needsSetup: NavKey[] }) {
  const navRef = useRef<HTMLDivElement>(null);
  const [marker, setMarker] = useState<{ top: number; height: number } | null>(null);

  // The active marker slides between items instead of jumping.
  useLayoutEffect(() => {
    const nav = navRef.current;
    const el = nav?.querySelector<HTMLElement>(`[data-nav="${active.key}"]`);
    if (nav && el) setMarker({ top: el.getBoundingClientRect().top - nav.getBoundingClientRect().top, height: el.offsetHeight });
  }, [active.key]);

  // Labels fade out fast when collapsing and fade in after the width has mostly opened.
  const label = `whitespace-nowrap transition-[opacity,translate] ${collapsed ? "opacity-0 -translate-x-1 duration-100" : "opacity-100 translate-x-0 duration-200 delay-100"}`;

  return (
    <aside
      style={{ width: collapsed ? COLLAPSED : EXPANDED }}
      className="hidden lg:flex shrink-0 sticky z-20 top-12 h-[calc(100dvh-48px)] flex-col bg-chrome border-r border-chrome-line transition-[width] duration-[280ms] ease-drawer"
    >
      {/* Product switcher with the collapse toggle beside it; collapsed, the toggle sits under the product initial. */}
      <div className={`p-3 pb-2 flex gap-1.5 ${collapsed ? "flex-col" : "items-center"}`}>
        <div className="flex-1 min-w-0">
          <ProductSwitcher products={products} current={current} compact={collapsed} />
        </div>
        <div className="relative has-tip shrink-0">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`h-10 grid place-items-center rounded-[3px] text-chrome-fg-2 hover:text-chrome-fg hover:bg-chrome-2 transition-colors duration-200 ${collapsed ? "w-full" : "w-9"}`}
          >
            <span className={`transition-transform duration-[280ms] ease-drawer ${collapsed ? "rotate-180" : ""}`}>
              <Icon d="M4 5h16v14H4zM9 5v14M15 10l-2 2 2 2" />
            </span>
          </button>
          <span className="tip">{collapsed ? "Expand" : "Collapse"} sidebar · ⌘B</span>
        </div>
      </div>

      <div ref={navRef} className="relative flex-1 px-3 py-2 flex flex-col gap-4 text-[14px]">
        {marker && (
          <span
            aria-hidden="true"
            className="absolute left-3 right-3 rounded-[3px] bg-chrome-3 transition-[translate,height] duration-[280ms] ease-drawer"
            style={{ top: 0, translate: `0 ${marker.top}px`, height: marker.height }}
          />
        )}
        {NAV_GROUPS.map((g) => (
          <nav key={g.label} aria-label={g.label} className="flex flex-col gap-px">
            <div className="relative h-7 flex items-center px-2.5 text-[12px] font-medium text-chrome-fg-3">
              <span className={label}>{g.label}</span>
              <span className={`absolute left-4 right-4 top-1/2 h-px bg-chrome-line transition-opacity duration-200 ${collapsed ? "opacity-100 delay-100" : "opacity-0"}`} />
            </div>
            {g.items.map((it) => {
              const on = it.key === active.key;
              const off = needsSetup.includes(it.key);
              return (
                <div key={it.key} className="relative has-tip">
                  <Link
                    href={`/p/${current.slug}${it.path}`}
                    data-nav={it.key}
                    aria-current={on ? "page" : undefined}
                    aria-label={collapsed ? it.label : undefined}
                    className={`relative h-9 flex items-center gap-3 pl-[13px] pr-2 rounded-[3px] overflow-hidden transition-colors duration-200 ${on ? "text-chrome-fg font-medium [&_svg]:text-signal" : off ? "text-chrome-fg-3 hover:text-chrome-fg-2 hover:bg-chrome-2" : "text-chrome-fg-2 hover:text-chrome-fg hover:bg-chrome-2"}`}
                  >
                    <Icon d={it.icon} />
                    <span className={`flex-1 ${label}`}>{it.label}</span>
                    {off && <span className={`text-[11px] font-normal text-chrome-fg-3 ${label}`}>set up</span>}
                  </Link>
                  {collapsed && <span className="tip">{it.label}{off ? " · not set up" : ""}</span>}
                </div>
              );
            })}
          </nav>
        ))}
      </div>
    </aside>
  );
}
