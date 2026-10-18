import "server-only";
import { getDb } from "./db";
import { fetchAll } from "./apple-ads";
import type { B2BSocialData, ReachAccount, ReachCompany, ReachGroup, ReachPerson } from "./b2b-social";

/**
 * Loads a product's B2B Social data from the b2b_ tables and its 'b2b_social' tracked sources into the shape the page
 * works on (B2BSocialData). Null when the product watches nothing yet. Filled by `pnpm b2b-social sync` (and `import`).
 */
export async function loadB2BSocial(productId: string): Promise<B2BSocialData | null> {
  const db = getDb();
  const sources = await fetchAll((from, to) => db.from("tracked_sources").select("kind, value, label, config").eq("product_id", productId).eq("source", "b2b_social").range(from, to), "b2b sources");
  if (!sources.length) return null;
  const [posts, comments, people] = await Promise.all([
    fetchAll(
      (from, to) =>
        db
          .from("b2b_posts")
          .select("id, platform, external_id, account_handle, url, text, posted_at, format, is_reply, views, likes, comments, reposts, quotes, bookmarks, replies_checked_at")
          .eq("product_id", productId)
          .range(from, to),
      "b2b posts",
    ),
    fetchAll((from, to) => db.from("b2b_comments").select("post_id, author_name, author_url, text, url, posted_at").eq("product_id", productId).range(from, to), "b2b comments"),
    fetchAll((from, to) => db.from("b2b_people").select("*").eq("product_id", productId).range(from, to), "b2b people"),
  ]);

  const accounts: ReachAccount[] = sources.map((s) => {
    const c = (s.config ?? {}) as { group?: ReachGroup; url?: string; followers?: number | null; employees?: number | null; sample?: "recent" | "popular" };
    return {
      platform: s.kind as "x" | "linkedin",
      handle: s.value,
      name: s.label ?? s.value,
      url: c.url ?? "",
      group: c.group ?? "competitor",
      followers: c.followers ?? null,
      employees: c.employees ?? null,
      sample: c.sample ?? "recent",
    };
  });

  // Comments point at posts by row id; the page keys posts by their platform id.
  const postKey = new Map(posts.map((p) => [p.id, p.external_id]));
  const companies = new Map<string, ReachCompany>();
  const persons: ReachPerson[] = people.map((p) => {
    const key = p.employer_url ?? (p.employer ? `company:${p.employer.toLowerCase()}` : null);
    if (key && p.employer && !companies.has(key)) {
      companies.set(key, {
        url: key,
        name: p.employer,
        domain: p.company_domain,
        size: p.company_size,
        employees: p.company_employees,
        industry: p.industry,
        fortune500: p.fortune500_rank,
        yc: p.yc_batch,
      });
    }
    return { url: p.url, found: p.found, location: p.location, followers: p.followers, employer: p.employer, employerUrl: key, title: p.title, linkedinUrl: p.linkedin_url, bio: p.bio };
  });

  const checked = posts
    .map((p) => p.replies_checked_at)
    .filter((d): d is string => !!d)
    .sort();
  return {
    capturedAt: (checked.at(-1) ?? new Date().toISOString()).slice(0, 10),
    credits: 0,
    accounts,
    posts: posts.map((p) => ({
      platform: p.platform as "x" | "linkedin",
      id: p.external_id,
      handle: p.account_handle,
      url: p.url ?? "",
      text: p.text,
      postedAt: p.posted_at,
      format: p.format as "video" | "image" | "link" | "text",
      isReply: p.is_reply,
      views: p.views,
      likes: p.likes,
      comments: p.comments,
      reposts: p.reposts,
      quotes: p.quotes,
      bookmarks: p.bookmarks,
    })),
    comments: comments.map((c) => ({ postId: postKey.get(c.post_id) ?? "", authorName: c.author_name, authorUrl: c.author_url, text: c.text, url: c.url, postedAt: c.posted_at })),
    people: persons,
    companies: [...companies.values()],
  };
}
