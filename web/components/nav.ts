/** Product-scoped navigation, shared by the sidebar, the phone nav and the top-bar breadcrumb. */

export type NavKey = "brand" | "overview" | "meta" | "insights" | "organic" | "my-accounts" | "meta-ads" | "creatives" | "apple" | "apple-keywords" | "favorites";

export interface NavItem {
  key: NavKey;
  label: string;
  /** Path under /p/<slug>; "" is the overview. */
  path: string;
  icon: string;
}

const ICON = {
  overview: "M4 5h16v4H4zM4 13h7v6H4zM15 13h5v6h-5z",
  brand: "M5 4h14v16H5zM8 8h8M8 12h8M8 16h5",
  meta: "M3 15c2-8 5-8 7-2 2-6 5-6 7 2M3 15c1 3 3 3 4 0M17 15c1 3 3 3 4 0",
  organic: "M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z",
  accounts: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20c0-3 3-5 6-5s6 2 6 5M16 11a3 3 0 1 0 0-6M18 15c2 .5 4 2 4 5",
  metaAds: "M4 19V5M4 19h16M8 15v-4M12 15V8M16 15v-6",
  creatives: "M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v5H4zM13 14h7v5h-7z",
  apple: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4",
  keywords: "M4 7h16M4 12h10M4 17h7",
  insights: "M4 20h16M7 16v-5M12 16V6M17 16v-8",
  favorites: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z",
};

/** Three groups by job: the product itself, research (what competitors and creatives do), and the channels you run. */
export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Product",
    items: [
      { key: "overview", label: "Overview", path: "", icon: ICON.overview },
      { key: "brand", label: "Brand", path: "/brand", icon: ICON.brand },
    ],
  },
  {
    label: "Research",
    items: [
      { key: "meta", label: "Competitor ads", path: "/ads", icon: ICON.meta },
      { key: "insights", label: "Insights", path: "/insights", icon: ICON.insights },
      { key: "organic", label: "Organic", path: "/organic", icon: ICON.organic },
      { key: "creatives", label: "Creatives", path: "/creatives", icon: ICON.creatives },
      { key: "favorites", label: "Favorites", path: "/favorites", icon: ICON.favorites },
    ],
  },
  {
    label: "Your channels",
    items: [
      // Meta ads includes its "by creative attribute" view (/meta-ads/creatives) as a sub-tab.
      { key: "meta-ads", label: "Meta ads", path: "/meta-ads", icon: ICON.metaAds },
      { key: "apple", label: "Apple ads", path: "/apple-ads", icon: ICON.apple },
      { key: "apple-keywords", label: "Apple keywords", path: "/apple-keywords", icon: ICON.keywords },
      { key: "my-accounts", label: "My accounts", path: "/my-accounts", icon: ICON.accounts },
    ],
  },
];

export const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

/** The item a pathname belongs to: the longest matching path prefix, else the overview. /edit (the profile) is Brand's. */
export function activeNav(pathname: string, slug: string): NavItem {
  const rest = pathname.slice(`/p/${slug}`.length);
  if (rest === "/edit") return NAV_ITEMS.find((it) => it.key === "brand")!;
  const hits = NAV_ITEMS.filter((it) => it.path && (rest === it.path || rest.startsWith(`${it.path}/`)));
  return hits.sort((a, b) => b.path.length - a.path.length)[0] ?? NAV_ITEMS.find((it) => it.key === "overview")!;
}

export const SIDEBAR_COOKIE = "mf-sidebar";
/** Last product viewed; the home page sends you back to it. */
export const PRODUCT_COOKIE = "mf-product";
