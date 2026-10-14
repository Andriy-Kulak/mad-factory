import "server-only";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAppleAdsOverview } from "../apple-ads";
import { getDb } from "../db";
import { getMetaAdsOverview } from "../meta-ads";
import { DEFAULT_WINDOW_DAYS, formatBrief, overviewFor } from "../overview";
import { dayRange, DOC_DIRS, DOC_EXT, docPath } from "./helpers";
import { docName, PRODUCT_DOC_KINDS } from "../../../src/lib/product-docs.ts";
import { applyAdFilters, NO_AD_FILTERS, sortAdCards, type AdCard } from "../ad-cards";
import { getCreativeProfile } from "../creatives";
import { favoriteIds } from "../favorites";
import { applyOrganicFilters, NO_FILTERS, sortPosts } from "../organic-filters";
import { competitorAds } from "../queries";
import { organicOverview, SOCIAL_PLATFORMS, type OrganicPost } from "../social";
import { listTrackedSourceItems, trackedSourceUrl } from "../tracked-sources";
import { insertTrackedSource, recordSave, SAVE_CREDITS_PER_DAY, saveCreditsUsedToday, writeFavorites } from "../research-writes";
import { saveAd, savePost } from "../../../src/research/save-item.ts";
import { isAdRelation, parseAdLibraryInput, parseSocialAccountInput } from "../../../src/lib/tracked-source-input.ts";
import type { McpKeyScope } from "../../../src/lib/mcp-key.ts";

const READ_RULES = `Rules: this server is read-only. Changes to ad accounts are made by the owner's own agents after the owner approves a written plan,
so propose changes as text with the number each should move. Judge on complete days (yesterday and before); store revenue and trials
arrive a day or two late, so the most recent days undercount.`;
const RESEARCH_RULES = `Rules: this key may also write research data: track_ad_library and track_social_account follow a competitor or adjacent-niche
(inspiration) page or account (fetched on the next daily sync), and favorite stars or unstars single ads and posts without following
their account, and save_url saves one ad or post from a link (it costs ScrapeCreators credits, capped per day) and stars it.
Nothing else is writable: no deletes, no own accounts. Changes to ad accounts are made by the owner's own agents after the owner approves a written plan,
so propose changes as text with the number each should move. Judge on complete days (yesterday and before); store revenue and trials
arrive a day or two late, so the most recent days undercount.`;

/** Read by the agent when it connects: the goal first, then how to work with the data. */
export const mcpInstructions = (scope: McpKeyScope) => `This is the marketing workspace of a small app business. The top goal is profit, as a number: per product,
monthly profit = store proceeds (RevenueCat) - ad spend on every channel - fixed costs, measured against the product's monthly target.
Judge every channel, experiment and idea by how it moves that number.

How to work:
1. Call start_here, then brief for the product. brief is the one-page state: goal, last complete days per channel, running experiments, stale data.
2. recent_activity is what happened in the last 30 days: experiment log entries (decisions, observations, follow-ups) and every write made to the ad accounts.
3. Research: competitor_ads (Meta Ad Library ads of competitors and adjacent niches, with each video's angle and hook), organic_posts
   (Instagram/TikTok/Facebook posts scored as outliers against their account's median views), creative_profile for one media file's
   full breakdown, tracked_sources for which pages and accounts are followed. favorites_only narrows both lists to starred items.
4. experiments / experiment for the tests and their rules; product_docs for the brand: audiences, angles, claim limits, voice — read before writing copy. Use product_docs for plans and write-ups too; apple_ads and meta_ads for channel detail; list_docs / read_doc for playbooks and design docs.

${scope === "research" ? RESEARCH_RULES : READ_RULES}`;

/** Keys that only cost tokens: raw API payloads and ids the agent already has from the product. */
const DROP = new Set(["raw", "product_id", "tracked_source_id", "ad_account_id"]);
/** JSON for the model, compact. */
const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, (k, v) => (DROP.has(k) ? undefined : v)) }] });
const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
const repoRoot = basename(process.cwd()) === "web" ? resolve(process.cwd(), "..") : process.cwd();

async function resolveProduct(ref?: string) {
  const rows = await getDb().from("products").select("id, slug, name").order("slug");
  if (rows.error) throw new Error(`products: ${rows.error.message}`);
  const products = rows.data ?? [];
  if (ref) {
    const p = products.find((x) => x.slug === ref || x.id === ref);
    if (!p) throw new Error(`No product "${ref}". Products: ${products.map((x) => x.slug).join(", ") || "none"}`);
    return p;
  }
  if (products.length === 1) return products[0];
  throw new Error(`Pass product (one of: ${products.map((x) => x.slug).join(", ") || "none"})`);
}

async function listDocs(dir: string): Promise<string[]> {
  const entries = await readdir(join(repoRoot, dir), { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const e of entries) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...(await listDocs(rel)));
    else if (DOC_EXT.test(e.name)) out.push(rel);
  }
  return out;
}

const MAX_DOC_CHARS = 100_000;
async function readDoc(path: string): Promise<string> {
  const abs = docPath(path, repoRoot);
  if (!abs) throw new Error(`Not a readable doc: ${path}. Use list_docs for paths (${DOC_DIRS.join(", ")}).`);
  const body = await readFile(abs, "utf8");
  return body.length > MAX_DOC_CHARS ? `${body.slice(0, MAX_DOC_CHARS)}\n\n[truncated at ${MAX_DOC_CHARS} characters]` : body;
}

const product = z.string().optional().describe("Product slug or id; optional when there is only one product");
const days = z.number().int().min(1).max(90).optional().describe(`Last N complete days (default ${DEFAULT_WINDOW_DAYS})`);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const range = { days, from: day.optional().describe("First day, YYYY-MM-DD (overrides days)"), to: day.optional().describe("Last day, YYYY-MM-DD (default yesterday)") };
const limit = z.number().int().min(1).max(500).optional().describe("Max rows per list, by spend (default 25)");
const readOnly = { readOnlyHint: true, openWorldHint: false } as const;
/** Research writes add a row or flip a star; repeating one changes nothing more. */
const researchWrite = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const researchRelation = z.enum(["competitor", "inspiration"]).describe("competitor = a direct competitor, inspiration = an adjacent niche worth learning from");
const label = z.string().max(80).optional().describe("Short display name, e.g. the brand");

const AD_BODY_MAX = 600;
/** One competitor ad card, compact: no avatars or raw payloads; ids are what favorites take. */
function adCardView(c: AdCard, starred: ReadonlySet<string>) {
  return {
    id: c.id,
    ad_ids: c.memberIds,
    library_url: `https://www.facebook.com/ads/library/?id=${c.externalId}`,
    advertiser: c.advertiserName,
    relation: c.relation,
    title: c.title,
    body: c.body && c.body.length > AD_BODY_MAX ? `${c.body.slice(0, AD_BODY_MAX)}…` : c.body,
    cta: c.cta,
    link: c.linkUrl,
    start_date: c.startDate,
    end_date: c.endDate,
    active: c.isActive,
    days: c.days,
    versions: c.versions,
    impressions_rank: c.rank?.rank ?? null,
    signal: c.signal,
    media_url: c.media?.url ?? null,
    media_type: c.media?.type ?? null,
    media_sha256: c.media?.sha256 ?? null,
    hook: c.profile?.hook ?? null,
    profile: c.profile?.fields ?? null,
    favorited: c.memberIds.some((id) => starred.has(id)),
  };
}

function postView(p: OrganicPost, starred: ReadonlySet<string>) {
  return {
    id: p.id,
    account: `${p.account.platform}:${p.account.handle}`,
    relation: p.account.relation,
    url: p.url,
    kind: p.kind,
    caption: p.caption,
    posted_at: p.postedAt,
    duration_s: p.durationS,
    views: p.views,
    likes: p.likes,
    comments: p.comments,
    shares: p.shares,
    saves: p.saves,
    engagement: p.engagement,
    outlier: p.outlier,
    video_url: p.videoUrl,
    thumbnail_url: p.thumbnailUrl,
    favorited: starred.has(p.id),
  };
}

/** `key.name` labels the key's save_url spend in scrape_runs and its daily credit cap. */
export function buildMcpServer(key: { scope: McpKeyScope; name: string } = { scope: "read", name: "" }): McpServer {
  const { scope } = key;
  const instructions = mcpInstructions(scope);
  const server = new McpServer({ name: "mad-factory", version: "1.0.0" }, { instructions });

  server.registerTool(
    "start_here",
    { title: "Start here", description: "The goal and how to use this server, plus every product with its monthly profit target. Call first.", inputSchema: {}, annotations: readOnly },
    async () => {
      const db = getDb();
      const [products, goals, productDocs] = await Promise.all([
        db.from("products").select("id, slug, name, description, target_audience, positioning").order("slug"),
        db.from("product_goals").select("product_id, metric, target, currency, monthly_fixed_costs, notes"),
        db.from("product_docs").select("product_id, name, sort, kind").in("kind", ["brand", "research"]).order("sort").order("name"),
      ]);
      if (products.error) throw new Error(`products: ${products.error.message}`);
      if (goals.error) throw new Error(`product_goals: ${goals.error.message}`);
      if (productDocs.error) throw new Error(`product_docs: ${productDocs.error.message}`);
      return json({
        instructions,
        products: (products.data ?? []).map((p) => ({
          ...p,
          goal: goals.data?.find((g) => g.product_id === p.id) ?? null,
          brand_docs: (productDocs.data ?? []).filter((doc) => doc.product_id === p.id).map((doc) => doc.name),
        })),
        docs: ["playbooks/daily-review.md", "docs/marketing-loop.md", "playbooks/apple-ads.md", "playbooks/meta-ads.md"],
      });
    },
  );

  server.registerTool(
    "brief",
    {
      title: "Brief",
      description:
        "Where a product stands: monthly profit goal and pace, the last N complete days per channel, own Meta ads by spend, running experiments and stale data. Same numbers as the web overview.",
      inputSchema: { product, days },
      annotations: readOnly,
    },
    async (args) => text(formatBrief(await overviewFor(await resolveProduct(args.product), { days: args.days }))),
  );

  server.registerTool(
    "experiments",
    {
      title: "Experiments",
      description: "A product's experiments (newest first): hypothesis, status, dates, budget, success criteria, rules, verdict.",
      inputSchema: { product, status: z.string().optional().describe("e.g. running, planned, concluded") },
      annotations: readOnly,
    },
    async (args) => {
      const p = await resolveProduct(args.product);
      let q = getDb().from("experiments").select("*").eq("product_id", p.id).order("start_date", { ascending: false, nullsFirst: true });
      if (args.status) q = q.eq("status", args.status);
      const res = await q;
      if (res.error) throw new Error(`experiments: ${res.error.message}`);
      return json(res.data);
    },
  );

  server.registerTool(
    "experiment",
    {
      title: "Experiment",
      description: "One experiment with its full log, open follow-ups and the write-up document.",
      inputSchema: { product, slug: z.string().describe("Experiment slug") },
      annotations: readOnly,
    },
    async (args) => {
      const p = await resolveProduct(args.product);
      const db = getDb();
      const exp = await db.from("experiments").select("*").eq("product_id", p.id).eq("slug", args.slug).maybeSingle();
      if (exp.error) throw new Error(`experiments: ${exp.error.message}`);
      if (!exp.data) throw new Error(`No experiment "${args.slug}" for ${p.slug}`);
      const log = await db.from("experiment_log").select("at, actor, kind, body, plan_path, source_url, due_on, resolved_at").eq("experiment_id", exp.data.id).order("at");
      if (log.error) throw new Error(`experiment_log: ${log.error.message}`);
      let writeup = null;
      if (exp.data.writeup_path) {
        const result = await db.from("product_docs").select("name, title, body_md").eq("product_id", p.id).eq("name", docName(exp.data.writeup_path)).maybeSingle();
        if (result.error) throw new Error(`product_docs: ${result.error.message}`);
        writeup = result.data;
      }
      return json({ ...exp.data, log: log.data, openFollowUps: (log.data ?? []).filter((l) => l.due_on && !l.resolved_at), writeup });
    },
  );

  server.registerTool(
    "recent_activity",
    {
      title: "Recent activity",
      description:
        "Everything that happened in the last N days (default 30), newest first: experiment log entries (decisions, observations, follow-ups) and every write made to the Apple Ads and Meta Ads accounts. Plus open follow-ups.",
      inputSchema: {
        product,
        days: z.number().int().min(1).max(90).optional().describe("Last N days (default 30)"),
        limit: z.number().int().min(1).max(1000).optional().describe("Max timeline entries, newest first (default 150)"),
      },
      annotations: readOnly,
    },
    async (args) => {
      const p = await resolveProduct(args.product);
      const db = getDb();
      const since = new Date(Date.now() - (args.days ?? 30) * 86_400_000).toISOString();
      const exps = await db.from("experiments").select("id, slug").eq("product_id", p.id);
      if (exps.error) throw new Error(`experiments: ${exps.error.message}`);
      const slugById = new Map((exps.data ?? []).map((e) => [e.id, e.slug]));
      const ids = [...slugById.keys()];
      const none = { data: [], error: null };
      const [log, open, apple, meta] = await Promise.all([
        ids.length
          ? db
              .from("experiment_log")
              .select("experiment_id, at, actor, kind, body, plan_path, source_url, due_on, resolved_at")
              .in("experiment_id", ids)
              .gte("at", since)
              .order("at", { ascending: false })
              .limit(500)
          : none,
        ids.length ? db.from("experiment_log").select("experiment_id, at, actor, kind, body, due_on").in("experiment_id", ids).not("due_on", "is", null).is("resolved_at", null).order("due_on") : none,
        db
          .from("apple_ads_changes")
          .select("at, actor, method, path, status, note, plan_path, campaign_id, keyword_id, experiment_id")
          .eq("product_id", p.id)
          .eq("is_write", true)
          .gte("at", since)
          .order("at", { ascending: false })
          .limit(500),
        db
          .from("meta_ads_changes")
          .select("at, actor, method, path, status, note, plan_path, object_type, object_id, experiment_id")
          .eq("product_id", p.id)
          .eq("is_write", true)
          .gte("at", since)
          .order("at", { ascending: false })
          .limit(500),
      ]);
      for (const [name, r] of [
        ["experiment_log", log],
        ["experiment_log", open],
        ["apple_ads_changes", apple],
        ["meta_ads_changes", meta],
      ] as const)
        if (r.error) throw new Error(`${name}: ${r.error.message}`);
      const exp = (id: string | null) => (id ? (slugById.get(id) ?? id) : null);
      const timeline = [
        ...(log.data ?? []).map(({ experiment_id, ...l }) => ({ type: "experiment_log", experiment: exp(experiment_id), ...l })),
        ...(apple.data ?? []).map(({ experiment_id, ...c }) => ({ type: "apple_ads_write", experiment: exp(experiment_id), ...c })),
        ...(meta.data ?? []).map(({ experiment_id, ...c }) => ({ type: "meta_ads_write", experiment: exp(experiment_id), ...c })),
      ].sort((a, b) => b.at.localeCompare(a.at));
      const max = args.limit ?? 150;
      return json({
        product: p.slug,
        since,
        truncated: timeline.length > max ? `${timeline.length - max} older entries left out; pass a higher limit or fewer days` : undefined,
        openFollowUps: (open.data ?? []).map(({ experiment_id, ...l }) => ({ experiment: exp(experiment_id), ...l })),
        timeline: timeline.slice(0, max),
      });
    },
  );

  server.registerTool(
    "apple_ads",
    {
      title: "Apple Ads",
      description:
        "Apple Ads for a date range: totals, by campaign, keyword (with top search terms), search term, country and day, with RevenueCat trials/paid/revenue per install keyword, and negative keywords that blocked impressions.",
      inputSchema: { product, ...range, limit },
      annotations: readOnly,
    },
    async (args) => {
      const p = await resolveProduct(args.product);
      const r = dayRange(args);
      const o = await getAppleAdsOverview(p.id, r);
      const n = args.limit ?? 25;
      return json({
        product: p.slug,
        range: r,
        lastSyncedAt: o.lastSyncedAt,
        revenuecat: o.revenuecat,
        totals: o.totals,
        campaigns: o.campaigns,
        keywords: o.keywords.slice(0, n).map((k) => ({ ...k, terms: k.terms.slice(0, 5) })),
        searchTerms: o.searchTerms.slice(0, n),
        withheldSearchTermRows: o.withheldSearchTermRows,
        negatives: o.negatives.slice(0, n),
        countries: o.countries,
        days: o.days,
      });
    },
  );

  server.registerTool(
    "meta_ads",
    {
      title: "Meta Ads (own account)",
      description: "Our own Meta Ads account for a date range: totals, by campaign, ad set, ad (with creative copy and attributes), country and day.",
      inputSchema: { product, ...range, limit },
      annotations: readOnly,
    },
    async (args) => {
      const p = await resolveProduct(args.product);
      const r = dayRange(args);
      const o = await getMetaAdsOverview(p.id, r);
      if (!o) return text("Meta Ads data is not set up for this workspace yet.");
      const n = args.limit ?? 25;
      return json({
        product: p.slug,
        range: r,
        lastRun: o.lastRun,
        currency: o.currency,
        totals: o.totals,
        campaigns: o.campaigns,
        adsets: o.adsets,
        ads: o.ads.slice(0, n),
        countries: o.countries,
        days: o.days,
      });
    },
  );

  server.registerTool(
    "competitor_ads",
    {
      title: "Competitor ads",
      description:
        "Meta Ad Library ads from tracked competitor and adjacent-niche pages, one card per creative group: copy, run length, impressions rank, signal (working = long-running or many versions, early = new and ranking), the video's angle/hook when profiled, and whether it is starred. Pass a card's media_sha256 to creative_profile for the full breakdown.",
      inputSchema: {
        product,
        relation: z.enum(["competitor", "inspiration"]).optional().describe("competitor = direct competitors, inspiration = adjacent niches; both when omitted"),
        status: z.enum(["active", "ended"]).optional(),
        signal: z.enum(["working", "early"]).optional(),
        min_days: z.number().int().min(1).optional().describe("Running for at least N days"),
        launched_days: z.number().int().min(1).optional().describe("Launched within the last N days"),
        q: z.string().optional().describe("Text search in copy, headline and advertiser"),
        favorites_only: z.boolean().optional(),
        sort: z.enum(["impressions", "newest", "longest", "variants"]).optional().describe("Default impressions"),
        limit: z.number().int().min(1).max(200).optional().describe("Max cards (default 25)"),
      },
      annotations: readOnly,
    },
    async (args) => {
      const p = await resolveProduct(args.product);
      const [cards, favs] = await Promise.all([competitorAds(p.id), favoriteIds(p.id, "ad")]);
      const starred = new Set(favs);
      const filters = {
        ...NO_AD_FILTERS,
        relation: args.relation ?? null,
        status: args.status ?? null,
        signal: args.signal ?? null,
        minDays: args.min_days ?? null,
        launchedDays: args.launched_days ?? null,
        q: args.q ?? "",
        favorites: args.favorites_only ?? false,
        sort: args.sort ?? "impressions",
        view: "cards" as const,
      };
      const matched = sortAdCards(applyAdFilters(cards, filters, Date.now(), starred), args.sort ?? "impressions");
      const n = args.limit ?? 25;
      return json({ product: p.slug, matched: matched.length, cards: matched.slice(0, n).map((c) => adCardView(c, starred)) });
    },
  );

  server.registerTool(
    "organic_posts",
    {
      title: "Organic posts",
      description:
        "Posts from tracked Instagram, TikTok and Facebook accounts with views, likes, comments, shares, saves (null = the platform doesn't return it), engagement rate and outlier score (views ÷ the account's median views). Defaults to competitor and inspiration accounts.",
      inputSchema: {
        product,
        relation: z.enum(["competitor", "inspiration", "own"]).optional().describe("Default: competitor and inspiration"),
        platform: z.enum(SOCIAL_PLATFORMS).optional(),
        q: z.string().optional().describe("Text search in captions"),
        min_outlier: z.number().min(0).optional().describe("e.g. 3 for posts with 3x the account's median views"),
        min_views: z.number().int().min(0).optional(),
        posted_within_days: z.number().int().min(1).optional(),
        favorites_only: z.boolean().optional(),
        sort: z.enum(["outlier", "views", "newest", "engagement"]).optional().describe("Default outlier"),
        limit: z.number().int().min(1).max(200).optional().describe("Max posts (default 25)"),
      },
      annotations: readOnly,
    },
    async (args) => {
      const p = await resolveProduct(args.product);
      const [{ accounts, posts }, favs] = await Promise.all([organicOverview(p.id, { relations: args.relation ? [args.relation] : ["competitor", "inspiration"] }), favoriteIds(p.id, "post")]);
      const starred = new Set(favs);
      const filters = {
        ...NO_FILTERS,
        q: args.q ?? "",
        platform: args.platform ?? null,
        outlier: { min: args.min_outlier ?? null, max: null },
        views: { min: args.min_views ?? null, max: null },
        postedWithin: args.posted_within_days ? { n: args.posted_within_days, unit: "days" as const } : null,
        favorites: args.favorites_only ?? false,
        sort: args.sort ?? "outlier",
        view: "grid" as const,
      };
      const matched = sortPosts(applyOrganicFilters(posts, filters, Date.now(), starred), args.sort ?? "outlier");
      const n = args.limit ?? 25;
      return json({
        product: p.slug,
        accounts: accounts.map(({ avatarUrl, ...a }) => a),
        matched: matched.length,
        posts: matched.slice(0, n).map((post) => postView(post, starred)),
      });
    },
  );

  server.registerTool(
    "creative_profile",
    {
      title: "Creative profile",
      description: "The full breakdown of one ad or post video (hook, transcript, structure, angle, audience, claims, production, people), by the media_sha256 from competitor_ads.",
      inputSchema: {
        sha256: z
          .string()
          .regex(/^[0-9a-f]{64}$/)
          .describe("media_sha256 from competitor_ads"),
      },
      annotations: readOnly,
    },
    async (args) => {
      const profile = await getCreativeProfile(args.sha256);
      return profile ? json(profile) : text(`No profile for ${args.sha256} yet; it is made on the next daily creatives run.`);
    },
  );

  server.registerTool(
    "tracked_sources",
    {
      title: "Tracked sources",
      description:
        "The Meta Ad Library pages and searches, and the Instagram/TikTok/Facebook accounts a product follows, with relation (competitor, inspiration, own), whether each is enabled and when it was last synced.",
      inputSchema: { product },
      annotations: readOnly,
    },
    async (args) => {
      const p = await resolveProduct(args.product);
      const [adLibrary, social] = await Promise.all([
        listTrackedSourceItems(p.id, { kind: "ad_library" }),
        listTrackedSourceItems(p.id, { kind: "social", relations: ["own", "competitor", "inspiration"] }),
      ]);
      const view = (s: (typeof adLibrary)[number]) => ({ ...s, url: trackedSourceUrl(s) });
      return json({ product: p.slug, ad_library: adLibrary.map(view), social: social.map(view) });
    },
  );

  server.registerTool(
    "product_docs",
    {
      title: "Product docs",
      description: "List or read a product document, optionally filtered by kind.",
      inputSchema: {
        product,
        name: z.string().min(1).optional().describe("Document name; omit to list available documents"),
        kind: z.enum(PRODUCT_DOC_KINDS).optional().describe("Filter by document kind"),
      },
      annotations: readOnly,
    },
    async (args) => {
      const p = await resolveProduct(args.product);
      const result = await getDb().from("product_docs").select("name, title, body_md, kind").eq("product_id", p.id).order("sort").order("name");
      if (result.error) throw new Error(`product_docs: ${result.error.message}`);
      const docs = (result.data ?? []).filter((item) => !args.kind || item.kind === args.kind);
      const title = (doc: (typeof docs)[number]) => doc.title ?? (doc.name === "readme" ? "Overview" : doc.name);
      if (args.name !== undefined) {
        const doc = docs.find((item) => item.name === args.name);
        if (!doc) throw new Error(`No document "${args.name}" for ${p.slug}. Valid names: ${docs.map((item) => item.name).join(", ") || "none"}`);
        return json({ name: doc.name, title: title(doc), kind: doc.kind, body_md: doc.body_md });
      }
      return json(docs.map((doc) => ({ name: doc.name, title: title(doc), kind: doc.kind })));
    },
  );

  server.registerTool(
    "list_docs",
    { title: "List docs", description: `Playbooks and design docs in the repo (${DOC_DIRS.join(", ")}). Use product_docs for product-specific documents.`, inputSchema: {}, annotations: readOnly },
    async () => json((await Promise.all(DOC_DIRS.map(listDocs))).flat()),
  );

  server.registerTool(
    "read_doc",
    { title: "Read doc", description: "One doc from list_docs, by repo-relative path.", inputSchema: { path: z.string().describe("e.g. playbooks/apple-ads.md") }, annotations: readOnly },
    async (args) => text(await readDoc(args.path)),
  );

  if (scope === "research") registerResearchWrites(server, key.name);
  return server;
}

/** Only for research-scoped keys: follow competitor/inspiration sources and star single items. Never own accounts, never deletes. */
function registerResearchWrites(server: McpServer, keyName: string) {
  server.registerTool(
    "track_ad_library",
    {
      title: "Track an Ad Library page",
      description:
        "Follow a competitor or adjacent-niche advertiser in the Meta Ad Library. Its ads are fetched on the next daily sync and then show in competitor_ads. To save one ad without following its page, use favorite on it instead.",
      inputSchema: {
        product,
        input: z.string().min(1).describe("Numeric Facebook page ID, or a facebook.com/ads/library URL (page or keyword search)"),
        relation: researchRelation,
        label,
      },
      annotations: researchWrite,
    },
    async (args) => {
      const p = await resolveProduct(args.product);
      if (!isAdRelation(args.relation)) throw new Error("relation must be competitor or inspiration");
      const parsed = parseAdLibraryInput(args.input);
      const what = parsed.kind === "page" ? `Page ${parsed.value}` : `"${parsed.value}"`;
      return writeResult(
        await insertTrackedSource(
          {
            product_id: p.id,
            source: "meta",
            kind: parsed.kind,
            value: parsed.value,
            country: parsed.country,
            label: args.label?.trim() || null,
            config: { ...parsed.config, relation: args.relation },
          },
          what,
        ),
      );
    },
  );

  server.registerTool(
    "track_social_account",
    {
      title: "Track a social account",
      description:
        "Follow a competitor or adjacent-niche Instagram, TikTok or Facebook account. Its posts are fetched on the next daily sync and then show in organic_posts. To save one post without following the account, use favorite on it instead.",
      inputSchema: {
        product,
        platform: z.enum(SOCIAL_PLATFORMS),
        input: z.string().min(1).describe("Handle, @handle or profile URL (Facebook: profile URL or numeric page ID)"),
        relation: researchRelation,
        label,
      },
      annotations: researchWrite,
    },
    async (args) => {
      const p = await resolveProduct(args.product);
      if (!isAdRelation(args.relation)) throw new Error("relation must be competitor or inspiration");
      const value = parseSocialAccountInput(args.platform, args.input);
      const what = args.platform === "facebook" ? "That Facebook page" : `@${value}`;
      return writeResult(
        await insertTrackedSource({ product_id: p.id, source: args.platform, kind: "account", value, country: "ALL", label: args.label?.trim() || null, config: { relation: args.relation } }, what),
      );
    },
  );

  server.registerTool(
    "favorite",
    {
      title: "Star or unstar",
      description:
        "Star (or unstar) single competitor ads or organic posts so they show with favorites_only, without following their page or account. ids are card ids or ad_ids from competitor_ads, or post ids from organic_posts.",
      inputSchema: {
        product,
        kind: z.enum(["ad", "post"]),
        ids: z.array(z.string().uuid()).min(1).max(50),
        favorited: z.boolean().optional().describe("false to unstar; default true"),
      },
      annotations: researchWrite,
    },
    async (args) => {
      const p = await resolveProduct(args.product);
      const on = args.favorited ?? true;
      const wanted = new Set(args.ids);
      let targets: string[];
      if (args.kind === "ad") {
        // Like the web: starring a card stars its id; unstarring clears every version in the card.
        const cards = (await competitorAds(p.id)).filter((c) => wanted.has(c.id) || c.memberIds.some((id) => wanted.has(id)));
        for (const c of cards) for (const id of c.memberIds) wanted.delete(id);
        for (const c of cards) wanted.delete(c.id);
        targets = cards.flatMap((c) => (on ? [c.id] : c.memberIds));
      } else {
        const { posts } = await organicOverview(p.id, { relations: ["own", "competitor", "inspiration"] });
        const known = posts.filter((post) => wanted.has(post.id));
        for (const post of known) wanted.delete(post.id);
        targets = known.map((post) => post.id);
      }
      if (wanted.size) throw new Error(`Not a ${args.kind} of ${p.slug}: ${[...wanted].join(", ")}. Use ids from ${args.kind === "ad" ? "competitor_ads" : "organic_posts"}.`);
      await writeFavorites(p.id, args.kind, targets, on);
      return json({ product: p.slug, kind: args.kind, favorited: on, ids: targets });
    },
  );

  server.registerTool(
    "save_url",
    {
      title: "Save one ad or post by link",
      description: `Fetch one Meta Ad Library ad (ad id or facebook.com/ads/library/?id= link) or one Instagram, TikTok or Facebook post, store it and star it, without following its page or account. Use it for something not in competitor_ads or organic_posts yet; it costs about 1 ScrapeCreators credit (free when it is already stored), up to ${SAVE_CREDITS_PER_DAY} a day per key. Saved ads show in competitor_ads and saved posts in organic_posts as competitor items.`,
      inputSchema: {
        product,
        url: z.string().min(1).max(500).describe("Ad Library ad id or link, or a post/reel/video link"),
      },
      annotations: { ...researchWrite, openWorldHint: true },
    },
    async (args) => {
      const p = await resolveProduct(args.product);
      if (!process.env.SCRAPECREATORS_API_KEY)
        return { ...text("save_url is not set up on this server (no ScrapeCreators key). Ask the owner, or star an item that is already stored."), isError: true };
      const used = await saveCreditsUsedToday(keyName);
      if (used >= SAVE_CREDITS_PER_DAY) return { ...text(`This key used its ${SAVE_CREDITS_PER_DAY} save_url credits for today (UTC). Try again tomorrow.`), isError: true };
      const input = args.url.trim();
      const isAd = /^\d+$/.test(input) || /facebook\.com\/ads\/library/i.test(input);
      let saved;
      try {
        saved = isAd ? await saveAd(p.id, input) : await savePost(input);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (!/^Give |^That is an Ad Library/.test(message)) await recordSave(p.id, keyName, 0, message.slice(0, 500));
        return { ...text(message), isError: true };
      }
      if (saved.credits) await recordSave(p.id, keyName, saved.credits);
      let target = saved.id;
      if (saved.kind === "ad") target = (await competitorAds(p.id)).find((c) => c.id === saved.id || c.memberIds.includes(saved.id))?.id ?? saved.id;
      await writeFavorites(p.id, saved.kind, [target], true);
      return json({
        product: p.slug,
        kind: saved.kind,
        id: target,
        favorited: true,
        already_stored: saved.alreadyStored,
        media_stored: saved.mediaStored,
        credits_used: saved.credits,
        credits_left_today: Math.max(0, SAVE_CREDITS_PER_DAY - used - saved.credits),
      });
    },
  );
}

const writeResult = (r: { error?: string; ok?: string }) => (r.error ? { ...text(r.error), isError: true } : text(r.ok ?? "Done."));
