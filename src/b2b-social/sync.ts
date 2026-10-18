import { createHash } from "node:crypto";
import { finishScrapeRun, startScrapeRun } from "../db/ads.ts";
import { getDb } from "../db/client.ts";
import type { B2BCommentInsert, B2BPersonInsert, B2BPostInsert, B2BPostRow, TrackedSourceRow } from "../db/types.ts";
import { integrationStatus } from "../lib/integrations.ts";
import { scrapeCreatorsGet } from "../lib/scrapecreators.ts";
import {
  B2B_SOURCE,
  commentAuthors,
  insertB2BComments,
  knownPeopleUrls,
  unenrichedLinkedIn,
  listB2BPosts,
  listB2BSources,
  updateB2BSource,
  updateB2BPostComments,
  upsertB2BPeople,
  upsertB2BPosts,
  type B2BAccountConfig,
  type B2BGroup,
} from "./db.ts";
import { COMMENT_WINDOW_DAYS, activityTime, bioJob, canonicalLinkedIn, commentsDue, fortune500Matcher, host, ycMatcher } from "./enrich.ts";
import { enrichWithExa } from "./exa.ts";
import { POST_FIELDS, X_POST_USD, X_USER_USD, xFormat, xGet, type XPage, type XUser } from "./x-api.ts";

/**
 * One incremental B2B Social run for a product (docs/B2B_SOCIAL_MVP.md, Steps 1–5). Each watched account remembers the
 * newest post seen and each post when its comments were fetched, so a run only pays for what is new and a missed day
 * is caught up by the next run (X replies within 7 days). Budget caps stop a phase cleanly.
 */

export interface SyncOptions {
  maxCredits: number;
  maxXUsd: number;
  maxExaUsd: number;
  dryRun: boolean;
  groups?: B2BGroup[];
  postsOnly?: boolean;
  fortune500Csv: string | null;
  ycCsv: string | null;
  log?: (line: string) => void;
}

export interface SyncSummary {
  newPosts: number;
  postsChecked: number;
  newComments: number;
  newPeople: number;
  credits: number;
  xUsd: number;
  exaUsd: number;
  skipped: string[];
}

type Json = Record<string, unknown>;
const rec = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const configOf = (s: TrackedSourceRow) => rec(s.config) as unknown as B2BAccountConfig;
const replyLimit = (config: Partial<B2BAccountConfig>) => {
  const configured = Number.isFinite(config.max_replies) ? Math.trunc(config.max_replies ?? 100) : 100;
  return Math.min(100, Math.max(10, configured));
};

export function parseB2BGroupFilter(value: string | undefined): B2BGroup[] | undefined {
  if (value === undefined) return undefined;
  const groups = value.split(",").map((group) => group.trim());
  const allowed: B2BGroup[] = ["company", "team", "competitor"];
  if (!groups.length || groups.some((group) => !allowed.includes(group as B2BGroup))) {
    throw new Error("--group must be a comma-separated list of company, team or competitor");
  }
  return [...new Set(groups as B2BGroup[])];
}

export function estimateXReplyUsd(
  posts: Pick<B2BPostRow, "account_handle" | "comments">[],
  configByHandle: ReadonlyMap<string, Partial<B2BAccountConfig>>,
): { perAccount: Map<string, number>; totalUsd: number } {
  const perAccount = new Map<string, number>();
  for (const post of posts) {
    const replies = Math.min(Math.max(0, post.comments ?? 0), replyLimit(configByHandle.get(post.account_handle) ?? {}));
    const usd = replies * (X_POST_USD + X_USER_USD);
    perAccount.set(post.account_handle, (perAccount.get(post.account_handle) ?? 0) + usd);
  }
  return { perAccount, totalUsd: [...perAccount.values()].reduce((sum, usd) => sum + usd, 0) };
}

export function xReplyParams(post: Pick<B2BPostRow, "external_id" | "account_handle" | "last_reply_id">, config: Partial<B2BAccountConfig>): Record<string, string> {
  const params: Record<string, string> = {
    query: `conversation_id:${post.external_id} -from:${post.account_handle} is:reply`,
    max_results: String(replyLimit(config)),
    sort_order: config.reply_order === "relevancy" ? "relevancy" : "recency",
    expansions: "author_id",
    "tweet.fields": "created_at",
    "user.fields": "description,location,public_metrics",
  };
  if (post.last_reply_id) params.since_id = post.last_reply_id;
  return params;
}

export async function syncB2BSocial(productId: string, opts: SyncOptions): Promise<SyncSummary> {
  const log = opts.log ?? (() => {});
  const now = new Date();
  const sum: SyncSummary = { newPosts: 0, postsChecked: 0, newComments: 0, newPeople: 0, credits: 0, xUsd: 0, exaUsd: 0, skipped: [] };
  const canSc = () => sum.credits < opts.maxCredits;
  const canX = () => sum.xUsd < opts.maxXUsd;
  const hasXApi = integrationStatus("x-api").configured;
  const hasExa = integrationStatus("exa").configured;
  const sc = async (path: string, params: Record<string, string>) => {
    const r = await scrapeCreatorsGet(path, params);
    sum.credits += r.creditsCharged || 1;
    return r.body;
  };

  const sources = (await listB2BSources(productId)).filter((s) => s.enabled && configOf(s).replies !== false && (!opts.groups || opts.groups.includes(configOf(s).group)));
  const replySources = sources;
  const sourceByHandle = new Map(sources.map((s) => [`${s.kind}:${s.value}`, s]));
  const replySourceByHandle = new Map(replySources.map((s) => [`${s.kind}:${s.value}`, s]));
  const existing = new Map((await listB2BPosts(productId)).map((p) => [`${p.platform}:${p.external_id}`, p]));
  log(`${sources.length} watched accounts (${sources.filter((s) => s.kind === "x").length} on X), ${existing.size} posts stored`);
  if (!hasXApi) {
    const message = "X phases skipped (X_BEARER_TOKEN is not configured)";
    sum.skipped.push(message);
    if (opts.dryRun) log(`skipped: ${message}`);
  }
  if (!hasExa && !opts.postsOnly) {
    const message = "Exa step skipped (EXA_API_KEY is not configured)";
    sum.skipped.push(message);
    if (opts.dryRun) log(`skipped: ${message}`);
  }

  if (opts.dryRun) {
    if (opts.postsOnly) {
      log(`dry run: posts-only; would check new posts on ${sources.length} accounts; comments, LinkedIn profiles and Exa skipped; no API calls made`);
      return sum;
    }
    const due = [...existing.values()].filter((p) => replySourceByHandle.has(`${p.platform}:${p.account_handle}`) && commentsDue({ ...p, platform: p.platform as "x" | "linkedin" }, now));
    log(`dry run: would check new posts on ${sources.length} accounts and comments on ${due.length} posts that are due; no API calls made`);
    const configByHandle = new Map(replySources.filter((s) => s.kind === "x").map((s) => [s.value, configOf(s)]));
    const estimate = estimateXReplyUsd(
      due.filter((p) => p.platform === "x"),
      configByHandle,
    );
    for (const [account, usd] of estimate.perAccount) log(`  X replies for ${account}: at most $${usd.toFixed(2)}`);
    log(`  X replies total: at most $${estimate.totalUsd.toFixed(2)}`);
    return sum;
  }

  const runId = await startScrapeRun({ product_id: productId, source: B2B_SOURCE, collector: "b2b-social" });
  try {
    // 1. New posts since each account's marker.
    for (const s of sources) {
      try {
        await syncPosts(s);
      } catch (error) {
        sum.skipped.push(`${s.kind} ${s.value}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (opts.postsOnly) {
      const message = "Comments, LinkedIn profile enrichment and Exa skipped (--posts-only)";
      sum.skipped.push(message);
      log(message);
      await finishScrapeRun(runId, { status: "done", ads_seen: sum.postsChecked, ads_new: sum.newComments, creatives_new: sum.newPeople, credits_used: sum.credits });
      return sum;
    }
    async function syncPosts(s: TrackedSourceRow): Promise<void> {
      if (s.kind === "x" && !hasXApi) return;
      const config = configOf(s);
      const fresh: B2BPostInsert[] = [];
      if (s.kind === "x") {
        if (!canX()) {
          sum.skipped.push(`X posts for ${s.value} (X budget)`);
          return;
        }
        if (!config.x_user_id) {
          const u = await xGet<{ data?: XUser }>(`/2/users/by/username/${s.value}`, {});
          sum.xUsd += X_USER_USD;
          if (!u.data) return;
          config.x_user_id = u.data.id;
        }
        const params: Record<string, string> = { max_results: "100", exclude: "retweets,replies", "tweet.fields": POST_FIELDS, expansions: "attachments.media_keys", "media.fields": "type" };
        if (config.last_post_id) params.since_id = config.last_post_id;
        else params.start_time = new Date(now.getTime() - COMMENT_WINDOW_DAYS.x * 86_400_000).toISOString();
        const page = await xGet<XPage>(`/2/users/${config.x_user_id}/tweets`, params);
        sum.xUsd += (page.data?.length ?? 0) * X_POST_USD;
        const media = new Map((page.includes?.media ?? []).map((m) => [m.media_key, m.type]));
        for (const t of page.data ?? []) {
          const m = t.public_metrics ?? {};
          const old = existing.get(`x:${t.id}`);
          if (old) {
            if (m.reply_count !== undefined && old.comments !== m.reply_count) {
              await updateB2BPostComments(old.id, m.reply_count);
              old.comments = m.reply_count;
            }
            continue;
          }
          fresh.push({
            product_id: productId,
            tracked_source_id: s.id,
            platform: "x",
            external_id: t.id,
            account_handle: s.value,
            url: `https://x.com/${s.value}/status/${t.id}`,
            text: t.text,
            posted_at: t.created_at ?? null,
            format: xFormat(t, media),
            views: m.impression_count ?? null,
            likes: m.like_count ?? null,
            comments: m.reply_count ?? null,
            reposts: m.retweet_count ?? null,
            quotes: m.quote_count ?? null,
            bookmarks: m.bookmark_count ?? null,
            replies_open_until: t.created_at ? new Date(Date.parse(t.created_at) + COMMENT_WINDOW_DAYS.x * 86_400_000).toISOString() : null,
          });
        }
        if (page.meta?.newest_id) config.last_post_id = page.meta.newest_id;
      } else {
        if (!canSc()) {
          sum.skipped.push(`LinkedIn posts for ${s.value} (credit budget)`);
          return;
        }
        const url = config.url;
        const isPerson = /\/in\//.test(url);
        const body = await sc(isPerson ? "/v1/linkedin/profile" : "/v1/linkedin/company", { url });
        const listed = isPerson
          ? [...(Array.isArray(body.recentPosts) ? body.recentPosts : []), ...(Array.isArray(body.activity) ? body.activity : [])]
              .map(rec)
              .filter((p) => str(p.link)?.includes(`/posts/${s.value}`))
              .map((p) => ({ url: str(p.link), text: str(p.title) }))
          : (Array.isArray(body.posts) ? body.posts : []).map(rec).map((p) => ({ url: str(p.url), text: str(p.text) }));
        for (const p of listed) {
          const id = p.url?.match(/activity-(\d{15,25})/)?.[1];
          if (!id || existing.has(`linkedin:${id}`) || fresh.some((f) => f.external_id === id)) continue;
          fresh.push({ product_id: productId, tracked_source_id: s.id, platform: "linkedin", external_id: id, account_handle: s.value, url: p.url, text: p.text ?? "", posted_at: activityTime(id) });
        }
      }
      if (fresh.length) {
        await upsertB2BPosts(fresh);
        sum.newPosts += fresh.length;
      }
      await updateB2BSource(s.id, config);
      log(`  ${s.kind} ${s.value}: ${fresh.length} new posts`);
    }

    // 2. Comments on posts that are due.
    const posts = (await listB2BPosts(productId)).filter((p) => replySourceByHandle.has(`${p.platform}:${p.account_handle}`) && commentsDue({ ...p, platform: p.platform as "x" | "linkedin" }, now));
    const known = await knownPeopleUrls(productId);
    const f500 = fortune500Matcher(opts.fortune500Csv);
    // Every person row carries every column, so a batch upsert never nulls a required one.
    const person = (url: string, fields: Partial<B2BPersonInsert>): B2BPersonInsert => ({
      product_id: productId,
      url,
      name: null,
      linkedin_url: null,
      location: null,
      bio: null,
      followers: null,
      found: true,
      title: null,
      employer: null,
      employer_url: null,
      company_size: null,
      company_employees: null,
      company_domain: null,
      industry: null,
      fortune500_rank: null,
      yc_batch: null,
      enriched_at: null,
      ...fields,
    });
    for (const p of posts) {
      if (p.platform === "x" && !hasXApi) continue;
      try {
        await syncComments(p);
      } catch (error) {
        sum.skipped.push(`comments on ${p.url}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    async function syncComments(p: B2BPostRow): Promise<void> {
      const comments: B2BCommentInsert[] = [];
      const people = new Map<string, B2BPersonInsert>();
      const patch: Partial<B2BPostRow> = { replies_checked_at: now.toISOString() };
      if (p.platform === "x") {
        if (!canX()) {
          sum.skipped.push(`replies on ${p.url} (X budget)`);
          return;
        }
        const source = sourceByHandle.get(`x:${p.account_handle}`);
        const params = xReplyParams(p, source ? configOf(source) : {});
        const page = await xGet<XPage>("/2/tweets/search/recent", params);
        sum.xUsd += (page.data?.length ?? 0) * X_POST_USD + (page.includes?.users?.length ?? 0) * X_USER_USD;
        const users = new Map((page.includes?.users ?? []).map((u) => [u.id, u]));
        for (const t of page.data ?? []) {
          const u = users.get(t.author_id ?? "");
          if (!u) continue;
          const url = `https://x.com/${u.username.toLowerCase()}`;
          comments.push({
            product_id: productId,
            post_id: p.id,
            external_id: t.id,
            author_url: url,
            author_name: u.name,
            text: t.text.replace(/^(@\w+\s+)+/, ""),
            url: `https://x.com/${u.username}/status/${t.id}`,
            posted_at: t.created_at ?? null,
          });
          if (!known.has(url) && !people.has(url)) {
            const job = bioJob(u.description);
            people.set(
              url,
              person(url, {
                name: u.name,
                bio: u.description ?? null,
                location: u.location || null,
                followers: u.public_metrics?.followers_count ?? null,
                title: job?.title ?? null,
                employer: job?.company ?? null,
                fortune500_rank: f500(job?.company),
                enriched_at: now.toISOString(),
              }),
            );
          }
        }
        if (page.meta?.newest_id) patch.last_reply_id = page.meta.newest_id;
      } else {
        if (!canSc()) {
          sum.skipped.push(`comments on ${p.url} (credit budget)`);
          return;
        }
        const body = await sc("/v1/linkedin/post", { url: p.url ?? "" });
        patch.likes = num(body.likeCount);
        patch.comments = num(body.commentCount);
        patch.comments_seen = num(body.commentCount);
        if (str(body.description)) patch.text = str(body.description)!;
        for (const c of (Array.isArray(body.comments) ? body.comments : []).map(rec)) {
          const url = canonicalLinkedIn(str(c.linkedinUrl));
          const text = str(c.text) ?? "";
          const external = createHash("sha256")
            .update(`${url ?? str(c.author) ?? ""}\u0000${text}`)
            .digest("hex")
            .slice(0, 32);
          comments.push({ product_id: productId, post_id: p.id, external_id: external, author_url: url, author_name: str(c.author)?.trim() ?? null, text });
          // Name-only for now; step 3 looks them up (rows with no enriched_at).
          if (url?.includes("/in/") && !known.has(url) && !people.has(url)) people.set(url, person(url, { name: str(c.author)?.trim() ?? null }));
        }
      }
      await insertB2BComments(comments);
      if (people.size) {
        await upsertB2BPeople([...people.values()]);
        for (const url of people.keys()) known.add(url);
        sum.newPeople += people.size;
      }
      const res = await getDb().from("b2b_posts").update(patch).eq("id", p.id);
      if (res.error) throw new Error(`update b2b_posts: ${res.error.message}`);
      sum.postsChecked++;
      sum.newComments += comments.length;
    }

    // 3. Who the LinkedIn commenters are: anyone with no row yet (a commenter saved by an earlier, failed run) or no
    // enrichment yet. Profile (employer) first, then the employer's page once per employer.
    const authors = await commentAuthors(productId);
    const missing = [...authors.entries()].filter(([url]) => url.includes("linkedin.com/in/") && !known.has(url)).map(([url, name]) => person(url, { name }));
    if (missing.length) await upsertB2BPeople(missing);
    const yc = ycMatcher(opts.ycCsv);
    const companyCache = new Map<string, Partial<B2BPersonInsert>>();
    const pending = await unenrichedLinkedIn(productId);
    for (const [i, row] of pending.entries()) {
      if (!canSc()) {
        sum.skipped.push(`${pending.length - i} LinkedIn profiles (credit budget)`);
        break;
      }
      const p = person(row.url, { name: row.name, enriched_at: now.toISOString() });
      try {
        const prof = await sc("/v1/linkedin/profile", { url: row.url });
        const job = rec((Array.isArray(prof.experience) ? prof.experience : [])[0]);
        const employer = str(job.name) && !/^\*+/.test(str(job.name)!) ? str(job.name) : null;
        const employerUrl = canonicalLinkedIn(str(job.url));
        Object.assign(p, { location: str(prof.location), followers: num(prof.followers), employer, employer_url: employerUrl, fortune500_rank: f500(employer) });
        if (employerUrl && /\/(company|school)\//.test(employerUrl)) {
          if (!companyCache.has(employerUrl) && canSc()) {
            const co = await sc("/v1/linkedin/company", { url: employerUrl });
            const domain = host(str(co.website));
            companyCache.set(employerUrl, {
              employer: str(co.name) ?? employer,
              company_size: str(co.size),
              company_employees: num(co.employeeCount),
              company_domain: domain,
              industry: str(co.industry),
              fortune500_rank: f500(str(co.name) ?? employer),
              yc_batch: yc(domain),
            });
          }
          Object.assign(p, companyCache.get(employerUrl) ?? {});
        }
      } catch {
        // Private or removed profiles cost nothing; record them as looked up so they are not retried.
        p.found = false;
      }
      await upsertB2BPeople([p]);
    }

    if (hasExa) {
      try {
        const exa = await enrichWithExa(productId, {
          maxUsd: opts.maxExaUsd,
          dryRun: false,
          f500,
          yc,
          log,
        });
        sum.exaUsd += exa.usd;
        sum.skipped.push(...exa.skipped);
      } catch (error) {
        sum.skipped.push(`Exa enrichment failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    await finishScrapeRun(runId, { status: "done", ads_seen: sum.postsChecked, ads_new: sum.newComments, creatives_new: sum.newPeople, credits_used: sum.credits });
    return sum;
  } catch (error) {
    await finishScrapeRun(runId, { status: "error", error: error instanceof Error ? error.message : String(error), credits_used: sum.credits }).catch(() => {});
    throw error;
  }
}
