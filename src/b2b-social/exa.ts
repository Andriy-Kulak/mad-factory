import { classifyComment, isSignal } from "./classify.ts";
import { listB2BComments, listB2BPeople, listB2BPosts, listB2BSources, updateB2BPerson } from "./db.ts";
import type { B2BCommentRow, B2BPersonRow, B2BPostRow, TrackedSourceRow } from "../db/types.ts";
import { canonicalLinkedIn, host, normalizeCompany } from "./enrich.ts";
import { requireEnv } from "../lib/env.ts";

export interface ExaRunOptions {
  pollMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function responseMessage(body: unknown, fallback: string): string {
  const row = object(body);
  if (typeof row.message === "string" && row.message) return row.message;
  if (typeof row.error === "string" && row.error) return row.error;
  const output = object(row.output);
  if (typeof output.text === "string" && output.text) return output.text;
  return fallback;
}

async function responseBody(response: Response): Promise<unknown> {
  return response.json().catch(() => ({}));
}

export async function exaAgentRun<T>(body: unknown, opts: ExaRunOptions = {}): Promise<{ structured: T; costUsd: number }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const pollMs = opts.pollMs ?? 5_000;
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  const deadline = Date.now() + timeoutMs;
  const headers = { Authorization: `Bearer ${requireEnv("EXA_API_KEY")}`, "content-type": "application/json" };
  let created: Response;
  try {
    created = await fetchImpl("https://api.exa.ai/agent/runs", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
    });
  } catch (error) {
    if (Date.now() >= deadline) throw new Error(`Exa Agent run creation timed out after ${timeoutMs}ms`);
    throw error;
  }
  const createdBody = await responseBody(created);
  if (!created.ok) throw new Error(`Exa Agent HTTP ${created.status}: ${responseMessage(createdBody, created.statusText)}`);
  const id = object(createdBody).id;
  if (typeof id !== "string" || !id) throw new Error("Exa Agent create response did not include a run id");

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, Math.max(0, deadline - Date.now()))));
    if (Date.now() >= deadline) break;
    let response: Response;
    try {
      response = await fetchImpl(`https://api.exa.ai/agent/runs/${encodeURIComponent(id)}`, {
        headers,
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      });
    } catch (error) {
      if (Date.now() >= deadline) throw new Error(`Exa Agent run ${id} timed out after ${timeoutMs}ms`);
      throw error;
    }
    const polledBody = await responseBody(response);
    if (!response.ok) throw new Error(`Exa Agent HTTP ${response.status}: ${responseMessage(polledBody, response.statusText)}`);
    const result = object(polledBody);
    const status = result.status;
    if (status === "failed" || status === "cancelled") {
      throw new Error(`Exa Agent run ${id} ${status}: ${responseMessage(polledBody, "no error message")}`);
    }
    if (status === "completed") {
      const output = object(result.output);
      const structured = output.structured;
      const cost = object(result.costDollars).total;
      if (structured === undefined) throw new Error(`Exa Agent run ${id} completed without structured output`);
      if (typeof cost !== "number" || !Number.isFinite(cost)) throw new Error(`Exa Agent run ${id} completed without a valid cost`);
      return { structured: structured as T, costUsd: cost };
    }
  }
  throw new Error(`Exa Agent run ${id} timed out after ${timeoutMs}ms`);
}

export interface ExaComment {
  author_url: string | null;
  text: string;
  post_id: string;
}

export interface ExaCandidateContext {
  posts: Pick<B2BPostRow, "id" | "tracked_source_id">[];
  sources: Pick<TrackedSourceRow, "id" | "label" | "config">[];
}

type Candidate = { person: B2BPersonRow; bigCompany: boolean; signal: boolean };

function candidateInfo(people: B2BPersonRow[], comments: ExaComment[], ctx: ExaCandidateContext): Candidate[] {
  const posts = new Map(ctx.posts.map((post) => [post.id, post]));
  const sources = new Map(ctx.sources.map((source) => [source.id, source]));
  const sourceConfig = (source: Pick<TrackedSourceRow, "config"> | undefined) => object(source?.config);
  const companyNames = ctx.sources
    .filter((source) => sourceConfig(source).group === "company")
    .map((source) => source.label)
    .filter((label): label is string => !!label);
  const teamUrls = new Set(
    ctx.sources
      .filter((source) => sourceConfig(source).group !== "competitor")
      .map((source) => sourceConfig(source).url)
      .filter((url): url is string => typeof url === "string")
      .map((url) => url.toLowerCase()),
  );
  const commentsByAuthor = new Map<string, ExaComment[]>();
  for (const comment of comments) {
    if (comment.author_url) commentsByAuthor.set(comment.author_url, [...(commentsByAuthor.get(comment.author_url) ?? []), comment]);
  }

  return people.flatMap((person) => {
    if (person.exa_checked_at !== null) return [];
    const personComments = commentsByAuthor.get(person.url) ?? [];
    const signal = personComments.some((comment) => {
      const post = posts.get(comment.post_id);
      const poster = post?.tracked_source_id ? sources.get(post.tracked_source_id) : undefined;
      const posterNames = [...companyNames, poster?.label ?? ""];
      return isSignal(classifyComment({ authorUrl: comment.author_url, text: comment.text }, { employer: person.employer }, posterNames));
    });
    const insiderByUrl = teamUrls.has(person.url.toLowerCase());
    const insiderByComments =
      personComments.length > 0 &&
      personComments.every((comment) => {
        const post = posts.get(comment.post_id);
        const poster = post?.tracked_source_id ? sources.get(post.tracked_source_id) : undefined;
        const posterNames = [...companyNames, poster?.label ?? ""];
        return classifyComment({ authorUrl: comment.author_url, text: comment.text }, { employer: person.employer }, posterNames) === "insider";
      });
    if (insiderByUrl || insiderByComments) return [];
    const bigCompany = person.fortune500_rank != null || (person.company_employees ?? 0) >= 10_000;
    if (!bigCompany && !signal) return [];
    return [{ person, bigCompany, signal }];
  });
}

function sortCandidates(a: Candidate, b: Candidate): number {
  return Number(b.bigCompany) - Number(a.bigCompany) || Number(b.signal) - Number(a.signal) || Date.parse(a.person.first_seen_at) - Date.parse(b.person.first_seen_at);
}

export function exaCandidates(people: B2BPersonRow[], comments: ExaComment[], ctx: ExaCandidateContext, limit?: number): { linkedin: B2BPersonRow[]; x: B2BPersonRow[] } {
  const eligible = candidateInfo(people, comments, ctx)
    .sort(sortCandidates)
    .filter(
      ({ person }) => (person.url.startsWith("https://www.linkedin.com/in/") && person.found && person.title === null) || (person.url.startsWith("https://x.com/") && person.linkedin_url === null),
    );
  const candidates = limit === undefined ? eligible : eligible.slice(0, Math.max(0, limit));
  return {
    linkedin: candidates.filter(({ person }) => person.url.startsWith("https://www.linkedin.com/in/") && person.found && person.title === null).map(({ person }) => person),
    x: candidates.filter(({ person }) => person.url.startsWith("https://x.com/") && person.linkedin_url === null).map(({ person }) => person),
  };
}

export interface LinkedInTitleOutput {
  linkedin_url: string | null;
  current_title: string | null;
  current_company: string | null;
}

export interface XMatchOutput {
  x_handle: string | null;
  linkedin_url: string | null;
  current_title: string | null;
  current_employer: string | null;
  confidence: "low" | "medium" | "high";
  employer_domain?: string | null;
  employer_employee_count?: string | null;
}

type CompanyRank = (company: string | null | undefined) => number | null;
type CompanyYc = (domain: string | null | undefined) => string | null;

export function applyLinkedInTitle(person: B2BPersonRow, out: LinkedInTitleOutput, f500: CompanyRank, _yc: CompanyYc): Partial<B2BPersonRow> | null {
  if (canonicalLinkedIn(out.linkedin_url) !== person.url) return null;
  const patch: Partial<B2BPersonRow> = { title: out.current_title || null };
  const currentCompany = out.current_company;
  if (typeof currentCompany === "string" && currentCompany.trim() && normalizeCompany(currentCompany) !== normalizeCompany(person.employer)) {
    patch.employer = currentCompany;
    patch.fortune500_rank = f500(currentCompany);
    patch.employer_url = null;
    patch.company_size = null;
    patch.company_employees = null;
    patch.company_domain = null;
    patch.industry = null;
    patch.yc_batch = null;
  }
  return patch;
}

export function parseEmployees(value: string | null | undefined): number | null {
  const first = value?.match(/\d[\d,]*/)?.[0]?.replaceAll(",", "");
  if (!first) return null;
  const count = Number.parseInt(first, 10);
  return Number.isFinite(count) ? count : null;
}

function normalizeXHandle(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const handle = value.trim().replace(/^@+/, "").toLowerCase();
  return handle || null;
}

function xHandleFromUrl(url: string): string | null {
  const handle = url.match(/^https:\/\/x\.com\/([^/?#]+)/i)?.[1];
  return normalizeXHandle(handle);
}

export function applyXMatch(person: B2BPersonRow, out: XMatchOutput, f500: CompanyRank, yc: CompanyYc): Partial<B2BPersonRow> | null {
  const handle = xHandleFromUrl(person.url);
  const outputHandle = normalizeXHandle(out.x_handle);
  const linkedinUrl = canonicalLinkedIn(out.linkedin_url);
  if (out.confidence === "low" || !handle || !outputHandle || outputHandle !== handle || !linkedinUrl || !/^https:\/\/www\.linkedin\.com\/in\/[^/]+$/.test(linkedinUrl)) return null;
  const employer = out.current_employer || null;
  const companyDomain = host(out.employer_domain);
  return {
    linkedin_url: linkedinUrl,
    title: out.current_title || null,
    employer,
    company_domain: companyDomain,
    company_employees: parseEmployees(out.employer_employee_count),
    fortune500_rank: f500(employer),
    yc_batch: yc(companyDomain),
  };
}

export function applyLinkedInBatch(people: B2BPersonRow[], outputs: LinkedInTitleOutput[], f500: CompanyRank, yc: CompanyYc): Map<string, Partial<B2BPersonRow> | null> {
  const outputsByUrl = new Map<string, LinkedInTitleOutput>();
  for (const output of outputs) {
    const url = canonicalLinkedIn(output.linkedin_url);
    if (url) outputsByUrl.set(url, output);
  }
  return new Map(
    people.map((person) => {
      const output = outputsByUrl.get(person.url);
      return [person.url, output ? applyLinkedInTitle(person, output, f500, yc) : null] as const;
    }),
  );
}

export function applyXMatchBatch(people: B2BPersonRow[], outputs: XMatchOutput[], f500: CompanyRank, yc: CompanyYc): Map<string, Partial<B2BPersonRow> | null> {
  const outputsByHandle = new Map<string, XMatchOutput>();
  for (const output of outputs) {
    const handle = normalizeXHandle(output.x_handle);
    if (handle) outputsByHandle.set(handle, output);
  }
  return new Map(
    people.map((person) => {
      const handle = xHandleFromUrl(person.url);
      const output = handle ? outputsByHandle.get(handle) : undefined;
      return [person.url, output ? applyXMatch(person, output, f500, yc) : null] as const;
    }),
  );
}

function linkedinTitleBody(people: B2BPersonRow[]) {
  return {
    query:
      "For each LinkedIn profile URL in the input data, use Fiber person enrichment to return the person's current job title and current employer. Do not guess; if Fiber has no data, leave current_title empty.",
    effort: "low",
    dataSources: [{ provider: "fiber" }],
    input: { data: people.map((person) => ({ linkedin_url: person.url })) },
    outputSchema: {
      type: "object",
      required: ["people"],
      properties: {
        people: {
          type: "array",
          maxItems: people.length,
          items: {
            type: "object",
            required: ["linkedin_url", "current_title", "current_company"],
            properties: {
              linkedin_url: { type: "string" },
              current_title: { type: "string" },
              current_company: { type: "string" },
            },
          },
        },
      },
    },
  };
}

function xMatchBody(people: B2BPersonRow[]) {
  return {
    query:
      "For each X (Twitter) user in the input data, find the same person's LinkedIn profile and current job using Fiber people data (match on X handle, name, bio and location). Return their LinkedIn URL, current title, current employer, the employer's website domain and employee count. Only return a match when you are confident it is the same person; otherwise leave linkedin_url empty and set confidence to low. Do not guess.",
    effort: "low",
    dataSources: [{ provider: "fiber" }],
    input: {
      data: people.map((person) => ({
        x_handle: person.url.match(/^https:\/\/x\.com\/([^/?#]+)/i)?.[1] ?? "",
        name: person.name ?? "",
        bio: person.bio ?? "",
        location: person.location ?? "",
      })),
    },
    outputSchema: {
      type: "object",
      required: ["people"],
      properties: {
        people: {
          type: "array",
          maxItems: people.length,
          items: {
            type: "object",
            required: ["x_handle", "linkedin_url", "current_title", "current_employer", "confidence"],
            properties: {
              x_handle: { type: "string" },
              confidence: { type: "string", enum: ["low", "medium", "high"] },
              linkedin_url: { type: "string" },
              current_title: { type: "string" },
              current_employer: { type: "string" },
              employer_domain: { type: "string" },
              employer_employee_count: { type: "string" },
            },
          },
        },
      },
    },
  };
}

export interface EnrichWithExaOptions {
  maxUsd: number;
  limit?: number;
  dryRun: boolean;
  f500: CompanyRank;
  yc: CompanyYc;
  log: (line: string) => void;
}

export interface ExaEnrichmentSummary {
  asked: number;
  matched: number;
  usd: number;
  skipped: string[];
}

async function runLinkedInBatch(people: B2BPersonRow[]) {
  return exaAgentRun<{ people: LinkedInTitleOutput[] }>(linkedinTitleBody(people));
}

async function runXBatch(people: B2BPersonRow[]) {
  return exaAgentRun<{ people: XMatchOutput[] }>(xMatchBody(people));
}

export async function enrichWithExa(productId: string, opts: EnrichWithExaOptions): Promise<ExaEnrichmentSummary> {
  const [people, comments, posts, sources] = await Promise.all([listB2BPeople(productId), listB2BComments(productId), listB2BPosts(productId), listB2BSources(productId)]);
  const candidates = exaCandidates(people, comments, { posts, sources }, opts.limit);
  const linkedin = candidates.linkedin;
  const x = candidates.x;
  const summary: ExaEnrichmentSummary = { asked: 0, matched: 0, usd: 0, skipped: [] };

  if (opts.dryRun) {
    summary.asked = linkedin.length + x.length;
    summary.usd = linkedin.length * 0.04 + x.length * 0.07;
    opts.log(`Exa dry run: ${linkedin.length} LinkedIn titles, ${x.length} X matches; estimated $${summary.usd.toFixed(2)}`);
    return summary;
  }

  let linkedinOffset = 0;
  let xOffset = 0;
  while (linkedinOffset < linkedin.length || xOffset < x.length) {
    const linkedinBatch = linkedin.slice(linkedinOffset, linkedinOffset + 13);
    const xBatch = x.slice(xOffset, xOffset + 13);
    if (summary.usd >= opts.maxUsd) {
      const remaining = linkedin.length - linkedinOffset + x.length - xOffset;
      summary.skipped.push(`Exa budget reached; ${remaining} people left (${linkedin.length - linkedinOffset} LinkedIn, ${x.length - xOffset} X)`);
      break;
    }
    linkedinOffset += linkedinBatch.length;
    xOffset += xBatch.length;
    summary.asked += linkedinBatch.length + xBatch.length;
    const settle = <T>(promise: Promise<T>) =>
      promise.then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      );
    const [linkedinResult, xResult] = await Promise.all([
      linkedinBatch.length ? settle(runLinkedInBatch(linkedinBatch)) : Promise.resolve(null),
      xBatch.length ? settle(runXBatch(xBatch)) : Promise.resolve(null),
    ]);

    if (linkedinResult) {
      if (linkedinResult.status === "rejected") {
        summary.skipped.push(`Exa LinkedIn batch of ${linkedinBatch.length} failed: ${linkedinResult.reason instanceof Error ? linkedinResult.reason.message : String(linkedinResult.reason)}`);
      } else {
        summary.usd += linkedinResult.value.costUsd;
        const outputs = linkedinResult.value.structured.people ?? [];
        const patches = applyLinkedInBatch(linkedinBatch, outputs, opts.f500, opts.yc);
        for (const person of linkedinBatch) {
          const patch = patches.get(person.url) ?? null;
          if (patch && (patch.title || patch.employer || patch.linkedin_url)) summary.matched++;
          await updateB2BPerson(productId, person.url, { ...(patch ?? {}), exa_checked_at: new Date().toISOString() });
        }
      }
    }
    if (xResult) {
      if (xResult.status === "rejected") {
        summary.skipped.push(`Exa X batch of ${xBatch.length} failed: ${xResult.reason instanceof Error ? xResult.reason.message : String(xResult.reason)}`);
      } else {
        summary.usd += xResult.value.costUsd;
        const outputs = xResult.value.structured.people ?? [];
        const patches = applyXMatchBatch(xBatch, outputs, opts.f500, opts.yc);
        for (const person of xBatch) {
          const patch = patches.get(person.url) ?? null;
          if (patch && (patch.title || patch.employer || patch.linkedin_url)) summary.matched++;
          await updateB2BPerson(productId, person.url, { ...(patch ?? {}), exa_checked_at: new Date().toISOString() });
        }
      }
    }
  }
  opts.log(`Exa: asked ${summary.asked}, matched ${summary.matched}, $${summary.usd.toFixed(2)}`);
  return summary;
}
