export function fmtDate(v: string | null | undefined): string {
  if (!v) return "–";
  // A bare date (YYYY-MM-DD) is a calendar day, not UTC midnight; formatting it in local time would show the day before.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(v);
  return new Date(dateOnly ? `${v}T12:00:00Z` : v).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", ...(dateOnly ? { timeZone: "UTC" } : {}) });
}

export function fmtDateTime(v: string | null | undefined): string {
  if (!v) return "–";
  return new Date(v).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export function fmtBytes(n: number): string {
  if (n < 1e6) return `${(n / 1e3).toFixed(0)} KB`;
  if (n < 1e9) return `${(n / 1e6).toFixed(1)} MB`;
  return `${(n / 1e9).toFixed(2)} GB`;
}

export function daysBetween(a: string | null, b: string | null): number | null {
  if (!a) return null;
  const end = b ? new Date(b) : new Date();
  return Math.max(0, Math.round((end.getTime() - new Date(a).getTime()) / 86_400_000));
}

/** Money in the goal's currency; whole units unless `cents`. Null shows a dash. */
export function fmtMoney(v: number | null | undefined, currency = "USD", cents = false): string {
  if (v == null) return "–";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 }).format(v || 0);
}

export function fmtInt(v: number | null | undefined): string {
  return v == null ? "–" : v.toLocaleString("en-US");
}

/** "3 h ago", "2 d ago". */
export function fmtAgo(v: string | null | undefined, now = Date.now()): string {
  if (!v) return "never";
  const h = Math.max(0, (now - Date.parse(v)) / 3_600_000);
  return h < 1 ? "just now" : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} d ago`;
}
