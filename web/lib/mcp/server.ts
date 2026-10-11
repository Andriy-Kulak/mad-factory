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

/** Read by the agent when it connects: the goal first, then how to work with the data. */
export const MCP_INSTRUCTIONS = `This is the marketing workspace of a small app business. The top goal is profit, as a number: per product,
monthly profit = store proceeds (RevenueCat) - ad spend on every channel - fixed costs, measured against the product's monthly target.
Judge every channel, experiment and idea by how it moves that number.

How to work:
1. Call start_here, then brief for the product. brief is the one-page state: goal, last complete days per channel, running experiments, stale data.
2. recent_activity is what happened in the last 30 days: experiment log entries (decisions, observations, follow-ups) and every write made to the ad accounts.
3. experiments / experiment for the tests and their rules; product_docs for the brand: audiences, angles, claim limits, voice — read before writing copy. Use product_docs for plans and write-ups too; apple_ads and meta_ads for channel detail; list_docs / read_doc for playbooks and design docs.

Rules: this server is read-only. Changes to ad accounts are made by the owner's own agents after the owner approves a written plan,
so propose changes as text with the number each should move. Judge on complete days (yesterday and before); store revenue and trials
arrive a day or two late, so the most recent days undercount.`;

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

export function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "mad-factory", version: "1.0.0" }, { instructions: MCP_INSTRUCTIONS });

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
        instructions: MCP_INSTRUCTIONS,
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

  return server;
}
