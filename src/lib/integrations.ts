/**
 * Every outside service mad-factory can use: the env vars that turn it on, what it enables and what still works
 * without it. Only Supabase is required; everything else is opt-in per feature. `pnpm doctor`, the CLIs' missing-key
 * errors, the web setup notes and the README table all read this list, so a new integration is added here first.
 * No dependencies, so the web app can import it too.
 */

export type IntegrationKey = "supabase" | "migrations" | "scrapecreators" | "r2" | "proxy" | "meta-ads" | "apple-ads" | "revenuecat" | "gemini" | "ai-gateway" | "web-auth";

export interface Integration {
  key: IntegrationKey;
  name: string;
  /** Configured when every variable of any one group is set. */
  env: string[][];
  /** Extra variables that only tune it. */
  optional?: string[];
  required: boolean;
  /** Where the keys go: the machine that runs the CLIs, the web host, or both. */
  where: "cli" | "web" | "both";
  /** A few words for tables. */
  summary: string;
  /** What it turns on, with the commands that need it. */
  enables: string;
  /** What happens without it. */
  without: string;
  /** Where to get the credentials. */
  setup: string;
}

export const INTEGRATIONS: Integration[] = [
  {
    key: "supabase",
    name: "Supabase",
    env: [["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]],
    required: true,
    where: "both",
    summary: "Database for everything",
    enables: "The database: products, ads, posts, metrics and the web app all live in Supabase Postgres.",
    without: "Nothing runs. A free Supabase project is enough.",
    setup: "supabase.com → your project → Project settings → API (project URL and the service_role key)",
  },
  {
    key: "migrations",
    name: "Database migrations",
    env: [["SUPABASE_DB_URL"]],
    required: false,
    where: "cli",
    summary: "Create and update tables",
    enables: "`pnpm db:migrate` creates and updates the tables.",
    without: "Apply supabase/migrations with the Supabase CLI instead (`supabase db push`).",
    setup: "Supabase → Connect → Session pooler connection string (IPv4)",
  },
  {
    key: "scrapecreators",
    name: "ScrapeCreators",
    env: [["SCRAPECREATORS_API_KEY"]],
    required: false,
    where: "cli",
    summary: "Competitor ads and organic posts",
    enables: "Competitor ads from the Meta Ad Library (`pnpm scrape`) and Instagram, TikTok and Facebook posts (`pnpm social`).",
    without: "`pnpm scrape --collector playwright` still collects Ad Library ads with a local browser; `pnpm social` cannot run.",
    setup: "scrapecreators.com → API key (paid per request)",
  },
  {
    key: "r2",
    name: "Cloudflare R2",
    env: [["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]],
    optional: ["R2_PUBLIC_URL"],
    required: false,
    where: "cli",
    summary: "Media storage for previews",
    enables: "Stores downloaded videos and images in a bucket, so the web app can play them.",
    without: "Media is saved under ./data/media on this machine and the web app shows placeholders instead of previews.",
    setup: "Cloudflare dashboard → R2 → create a bucket and an API token with object read & write",
  },
  {
    key: "proxy",
    name: "Proxy",
    env: [["PROXY_URL"]],
    required: false,
    where: "cli",
    summary: "Proxy for the browser collector",
    enables: "A rotating proxy for the Playwright Ad Library collector.",
    without: "The browser collector connects directly.",
    setup: "Any HTTP proxy, e.g. http://user:pass@host:port",
  },
  {
    key: "meta-ads",
    name: "Meta Ads (your ad account)",
    env: [["META_ADS_TOKEN"]],
    required: false,
    where: "cli",
    summary: "Your Meta ad account",
    enables: "Your own Meta campaigns, ad sets, ads, daily spend and results (`pnpm meta-ads`), and the Meta ads tab.",
    without: "Meta ads stays empty; competitor research from the Ad Library still works.",
    setup: "Meta Business settings → System users → generate a token with ads_read (ads_management only for approved writes)",
  },
  {
    key: "apple-ads",
    name: "Apple Ads",
    env: [["APPLE_ADS_DIR"], ["APPLE_ADS_CLIENT_ID", "APPLE_ADS_TEAM_ID", "APPLE_ADS_KEY_ID", "APPLE_ADS_PRIVATE_KEY"]],
    required: false,
    where: "cli",
    summary: "Your Apple Ads campaigns",
    enables: "Your own Apple Ads campaigns, keywords and search terms (`pnpm apple-ads`), and the Apple ads tabs.",
    without: "The Apple ads tabs stay empty.",
    setup: "ads.apple.com → Account settings → API: invite an API user, upload a public key, copy the client, team and key ids",
  },
  {
    key: "revenuecat",
    name: "RevenueCat",
    env: [["REVENUECAT_API_KEY"]],
    required: false,
    where: "cli",
    summary: "Revenue, trials and profit",
    enables: "Trials, subscriptions and revenue (`pnpm revenuecat`), so the overview can show profit against the goal.",
    without: "The overview shows ad spend but no revenue or profit.",
    setup: "RevenueCat → Project settings → API keys → a v2 secret key with read-only Charts & metrics access",
  },
  {
    key: "gemini",
    name: "Google Gemini",
    env: [["GEMINI_API_KEY"]],
    required: false,
    where: "both",
    summary: "AI creative breakdowns and transcripts",
    enables: "AI breakdowns of ad videos and images: hook, script, angle (`pnpm creatives profile`), and the Creatives tab. On the web host, the Transcribe button in an organic post's preview.",
    without: "Creatives stays empty and organic posts can't be transcribed; ads and posts are still collected.",
    setup: "aistudio.google.com → Get API key",
  },
  {
    key: "ai-gateway",
    name: "Vercel AI Gateway",
    env: [["AI_GATEWAY_API_KEY"]],
    required: false,
    where: "cli",
    summary: "Alternative model routing",
    enables: "Run creative profiles through `google/…` model ids with `--model`.",
    without: "Creative profiles call Gemini directly.",
    setup: "vercel.com → AI Gateway → API keys",
  },
  {
    key: "web-auth",
    name: "Web sign-in (GitHub)",
    env: [["AUTH_GITHUB_CLIENT_ID", "AUTH_GITHUB_CLIENT_SECRET", "AUTH_SECRET", "AUTH_ALLOWED_GITHUB_IDS"]],
    optional: ["AUTH_URL", "AUTH_DISABLED"],
    required: false,
    where: "web",
    summary: "Web app sign-in",
    enables: "Sign in to the web app with GitHub, limited to the listed numeric GitHub user IDs.",
    without: "The web app refuses to serve pages. For local `pnpm web` only, AUTH_DISABLED=true skips sign-in.",
    setup: "github.com/settings/developers → New OAuth app, callback <app url>/api/auth/callback; AUTH_SECRET: openssl rand -base64 32; your ID: api.github.com/users/<username> → id",
  },
];

const set = (env: Record<string, string | undefined>, name: string) => Boolean(env[name]?.length);

export function getIntegration(key: IntegrationKey): Integration {
  const it = INTEGRATIONS.find((i) => i.key === key);
  if (!it) throw new Error(`Unknown integration ${key}`);
  return it;
}

/**
 * Whether it is configured and, if not, what is missing from the closest group: the one with the most variables
 * already set (the one you started filling in), else the shortest.
 */
export function integrationStatus(key: IntegrationKey, env: Record<string, string | undefined> = process.env): { configured: boolean; missing: string[] } {
  const groups = getIntegration(key).env.map((g) => ({ done: g.length - g.filter((n) => !set(env, n)).length, missing: g.filter((n) => !set(env, n)) }));
  if (groups.some((g) => g.missing.length === 0)) return { configured: true, missing: [] };
  const best = groups.reduce((a, b) => (b.done > a.done || (b.done === a.done && b.missing.length < a.missing.length) ? b : a));
  return { configured: false, missing: best.missing };
}

/** "A, B and C", or "A, or B and C" for alternative groups. */
export function envHint(it: Integration): string {
  const list = (g: string[]) => (g.length > 1 ? `${g.slice(0, -1).join(", ")} and ${g.at(-1)}` : g[0]!);
  return it.env.map(list).join(", or ");
}

/** A setup problem, not a bug: CLIs print its message without a stack trace (see src/cli/errors.ts). */
export class MissingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingConfigError";
  }
}

export function missingConfigMessage(key: IntegrationKey): string {
  const it = getIntegration(key);
  return [
    `${it.name} is not configured.`,
    `  It enables: ${it.enables}`,
    `  Without it: ${it.without}`,
    `  Set ${envHint(it)} in .env (see .env.example).`,
    `  Get them: ${it.setup}`,
    "  Run `pnpm doctor` to see every integration.",
  ].join("\n");
}

/** Throws a readable MissingConfigError unless the integration is configured. */
export function requireIntegration(key: IntegrationKey, env: Record<string, string | undefined> = process.env): void {
  if (!integrationStatus(key, env).configured) throw new MissingConfigError(missingConfigMessage(key));
}
