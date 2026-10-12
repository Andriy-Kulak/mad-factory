import { readFile } from "node:fs/promises";
import { optionalEnv } from "../lib/env.ts";
import type { ApiPage, MetaAdsCallJournalEntry } from "./types.ts";

// OWNER RULE — read this before touching anything in this file:
// This client is read-only plus a small explicit allowlist of writes: `pause`,
// `activate`, `updateAdset`, `copyAdset`, `uploadVideo`, `uploadImage`, `createAd`
// and `updateAdCreative`. Nothing else, and there
// is deliberately no public generic post/request method — new writes are added by
// name here, never improvised. NEVER delete or archive a Meta ad, ad set, campaign
// or creative — not even if the owner asks. `assertNotDestructive` guards every
// request and throws on DELETE or DELETED/ARCHIVED values. Pausing is reversible;
// deleting is not. Ads created by `createAd` and ad sets created by `copyAdset`
// are always created PAUSED.

// Defence in depth for the owner rule above: writes may pause/activate/create, never delete or archive.
export function assertNotDestructive(method: string, params: Record<string, unknown>): void {
  const destructive =
    method.toUpperCase() === "DELETE" ||
    Object.values(params).some(
      (value) => typeof value === "string" && ["DELETED", "ARCHIVED"].includes(value.toUpperCase()),
    );
  if (destructive) {
    throw new Error("Refusing to delete/archive Meta objects: pause instead (owner rule, see AGENTS.md)");
  }
}

const API = "https://graph.facebook.com/v26.0";
const THROTTLE_CODES = new Set([4, 17, 613, 80000, 80003, 80004, 80014]);
const THROTTLE_SUBCODES = new Set([2446079, 1487742]);

export interface MetaAdsClientOptions {
  maxCalls?: number;
  journal?: (entry: MetaAdsCallJournalEntry) => Promise<void>;
}

type Params = Record<string, string | number | boolean>;

function parseUsage(headers: Headers): { usage: Record<string, unknown> | null; maxPercent: number } {
  const usage: Record<string, unknown> = {};
  let maxPercent = 0;
  const names = [
    ["x-business-use-case-usage", "business_use_case"],
    ["x-ad-account-usage", "ad_account"],
    ["x-fb-ads-insights-throttle", "insights_throttle"],
  ] as const;

  for (const [header, key] of names) {
    const value = headers.get(header);
    if (!value) continue;
    try {
      const parsed: unknown = JSON.parse(value);
      usage[key] = parsed;
      const visit = (entry: unknown) => {
        if (Array.isArray(entry)) {
          for (const child of entry) visit(child);
        } else if (entry && typeof entry === "object") {
          for (const [name, child] of Object.entries(entry)) {
            if ((name.endsWith("_util_pct") || ["call_count", "total_cputime", "total_time"].includes(name)) && Number.isFinite(Number(child))) {
              maxPercent = Math.max(maxPercent, Number(child));
            }
            visit(child);
          }
        }
      };
      visit(parsed);
    } catch {
      usage[key] = value;
    }
  }

  return { usage: Object.keys(usage).length ? usage : null, maxPercent };
}

function cleanParams(params: Params): Params {
  const out: Params = {};
  for (const [key, value] of Object.entries(params)) {
    if (!["access_token", "token", "appsecret_proof"].includes(key.toLowerCase())) out[key] = value;
  }
  return out;
}

function errorMessage(status: number, body: unknown): string | null {
  const error = body && typeof body === "object" && "error" in body ? (body as { error?: Record<string, unknown> }).error : undefined;
  const code = Number(error?.code);
  const subcode = Number(error?.error_subcode);
  const message = typeof error?.message === "string" ? error.message : "";
  const regain = error?.estimated_time_to_regain_access;
  // Keep Meta's useful error fields — "Invalid parameter" alone is unactionable.
  const details: string[] = [];
  if (Number.isFinite(subcode)) details.push(`subcode ${subcode}`);
  if (typeof error?.error_user_title === "string") details.push(error.error_user_title);
  if (typeof error?.error_user_msg === "string") details.push(error.error_user_msg);
  const detailText = details.length ? ` (${details.join(": ")})` : "";

  if (code === 190 || status === 401) return "token invalid or expired; regenerate the system-user token";
  if (THROTTLE_CODES.has(code) || THROTTLE_SUBCODES.has(subcode)) {
    const label = Number.isFinite(code) ? `code ${code}${Number.isFinite(subcode) ? `, subcode ${subcode}` : ""}` : `subcode ${subcode}`;
    const details = [`Meta API throttled (${label})`];
    if (regain !== undefined) details.push(`estimated_time_to_regain_access=${String(regain)}`);
    if (message) details.push(message.slice(0, 500));
    return details.join(": ");
  }
  if (status >= 400) return ((message + detailText) || `HTTP ${status}`).slice(0, 500);
  return null;
}

export class MetaAdsClient {
  private readonly token: string;
  private readonly fetchFn: typeof fetch;
  private readonly maxCalls: number;
  private readonly journal: MetaAdsClientOptions["journal"];
  private maxUsagePercent = 0;
  calls = 0;

  constructor(options: MetaAdsClientOptions = {}, fetchFn: typeof fetch = fetch) {
    this.token = optionalEnv("META_ADS_TOKEN") ?? "";
    if (!this.token) throw new Error("Meta Ads token missing: set META_ADS_TOKEN (see .env.example)");
    this.fetchFn = fetchFn;
    this.maxCalls = options.maxCalls ?? 40;
    if (!Number.isInteger(this.maxCalls) || this.maxCalls < 1) throw new Error("maxCalls must be a positive integer");
    this.journal = options.journal;
  }

  async get<T = unknown>(path: string, params: Params = {}): Promise<T> {
    if (!path.startsWith("/") || path.startsWith("//") || /[?#]/.test(path)) throw new Error("Meta GET path must start with / and contain no query string");
    if (/(?:^|[?&])(?:_?method|http_method)=/i.test(path) || Object.keys(params).some((key) => ["method", "_method", "http_method"].includes(key.toLowerCase()))) {
      throw new Error("Meta GET refuses a method override");
    }
    if (Object.keys(params).some((key) => ["access_token", "token"].includes(key.toLowerCase()))) {
      throw new Error("Meta token must not be passed as a parameter");
    }
    assertNotDestructive("GET", params);
    if (this.calls >= this.maxCalls) throw new Error("call ceiling reached");
    if (this.maxUsagePercent >= 90) throw new Error(`Meta usage at ${this.maxUsagePercent}%; stopping`);

    const safeParams = cleanParams(params);
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(safeParams)) query.set(key, String(value));
    const url = `${API}${path}${query.size ? `?${query.toString()}` : ""}`;
    const journalBase = { method: "GET" as const, path, params: safeParams, status: null as number | null, usage: null as MetaAdsCallJournalEntry["usage"] };
    this.calls++;

    let response: Response;
    try {
      response = await this.fetchFn(url, { method: "GET", headers: { Authorization: `Bearer ${this.token}` } });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      await this.journal?.({ ...journalBase, error: message });
      throw cause;
    }

    return (await this.finish(response, journalBase, `Meta GET ${path}`)).body as T;
  }

  // Write allowlist (see the owner rule at the top): POST /<objectId> with
  // status=PAUSED and nothing else. Resolves to `{ status, body }`.
  async pause(objectId: string): Promise<unknown> {
    if (!/^[^/?#]+$/.test(objectId)) throw new Error("pause expects a bare object id without slashes or query parts");
    return this.post(`/${objectId}`, { status: "PAUSED" });
  }

  // Allowlisted write: POST /<objectId> with status=ACTIVE and nothing else.
  async activate(objectId: string): Promise<unknown> {
    if (!/^[^/?#]+$/.test(objectId)) throw new Error("activate expects a bare object id without slashes or query parts");
    return this.post(`/${objectId}`, { status: "ACTIVE" });
  }

  // Allowlisted write: update an ad set's name, daily_min_spend_target and/or
  // daily_budget (cents). Only these three keys are ever sent; throws when all are empty.
  async updateAdset(adsetId: string, options: { name?: string; dailyMinSpendCents?: number; dailyBudgetCents?: number }): Promise<unknown> {
    if (!/^[^/?#]+$/.test(adsetId)) throw new Error("updateAdset expects a bare ad set id");
    const fields: Record<string, string> = {};
    if (options.name !== undefined) fields.name = options.name;
    if (options.dailyMinSpendCents !== undefined) fields.daily_min_spend_target = String(options.dailyMinSpendCents);
    if (options.dailyBudgetCents !== undefined) fields.daily_budget = String(options.dailyBudgetCents);
    if (!Object.keys(fields).length) throw new Error("updateAdset needs name, dailyMinSpendCents and/or dailyBudgetCents");
    return this.post(`/${adsetId}`, fields);
  }

  // Allowlisted write: copy an ad set into its own campaign WITHOUT its ads
  // (deep_copy=false). The copy is always PAUSED — there is no parameter to change
  // it. Meta ignores validate_only on /copies, so there is no dry run against Meta.
  // Resolves to `{ status, body }`; body.copied_adset_id is the new ad set.
  async copyAdset(adsetId: string): Promise<{ status: number; body: unknown }> {
    if (!/^[^/?#]+$/.test(adsetId)) throw new Error("copyAdset expects a bare ad set id");
    return this.post(`/${adsetId}/copies`, { deep_copy: "false", status_option: "PAUSED" });
  }

  // Allowlisted write: upload a video to /act_<id>/advideos, poll until it is
  // ready, then resolve a thumbnail. Resolves to `{ videoId, thumbnailUrl }`.
  async uploadVideo(accountId: string, filePath: string, title: string): Promise<{ videoId: string; thumbnailUrl: string | null }> {
    if (!/^act_\d+$/.test(accountId)) throw new Error("uploadVideo expects an act_<digits> account id");
    const buf = await readFile(filePath);
    const form = new FormData();
    form.set("title", title);
    form.set("source", new Blob([buf]), filePath.split("/").pop() ?? "video.mp4");
    const upload = await this.post(`/${accountId}/advideos`, { title, file: filePath }, form);
    const videoId = (upload.body as { id?: string }).id;
    if (!videoId) throw new Error(`Meta POST /${accountId}/advideos: response has no video id`);

    const deadline = Date.now() + 5 * 60_000;
    for (;;) {
      const status = await this.get<{ status?: { video_status?: string } }>(`/${videoId}`, { fields: "status" });
      const videoStatus = status.status?.video_status;
      if (videoStatus === "ready") break;
      if (videoStatus === "error") throw new Error(`Meta video ${videoId} processing failed`);
      if (Date.now() >= deadline) throw new Error(`Meta video ${videoId} not ready after 5 minutes`);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }

    return { videoId, thumbnailUrl: await this.videoThumbnail(videoId) };
  }

  // Allowlisted write: upload an image to /act_<id>/adimages (multipart field
  // `filename`). Resolves to the first entry's `{ hash }` — Meta keys images by
  // filename, so the response is a map, not a single object.
  async uploadImage(accountId: string, filePath: string): Promise<{ hash: string }> {
    if (!/^act_\d+$/.test(accountId)) throw new Error("uploadImage expects an act_<digits> account id");
    const buf = await readFile(filePath);
    const name = filePath.split("/").pop() ?? "image";
    const form = new FormData();
    form.set("filename", new Blob([buf]), name);
    const upload = await this.post(`/${accountId}/adimages`, { file: filePath }, form);
    const images = (upload.body as { images?: Record<string, { hash?: string }> }).images ?? {};
    const hash = Object.values(images)[0]?.hash;
    if (!hash) throw new Error(`Meta POST /${accountId}/adimages: response has no image hash`);
    return { hash };
  }

  // Read-only: the is_preferred thumbnail uri (else the first) for a video, or null.
  async videoThumbnail(videoId: string): Promise<string | null> {
    const thumbs = await this.get<ApiPage<{ uri?: string; is_preferred?: boolean }>>(`/${videoId}/thumbnails`, { fields: "uri,is_preferred" });
    const entries = thumbs.data ?? [];
    const preferred = entries.find((entry) => entry.is_preferred) ?? entries[0];
    return preferred?.uri ?? null;
  }

  // Allowlisted write: swap an existing ad's creative by POSTing a new inline
  // creative object (Meta creates the creative itself). Sends ONLY `creative`,
  // plus execution_options=["validate_only"] when requested — never `status`.
  async updateAdCreative(adId: string, creative: Record<string, unknown>, validateOnly: boolean): Promise<unknown> {
    if (!/^[^/?#]+$/.test(adId)) throw new Error("updateAdCreative expects a bare ad id");
    const fields: Record<string, string> = { creative: JSON.stringify(creative) };
    if (validateOnly) fields.execution_options = JSON.stringify(["validate_only"]);
    return this.post(`/${adId}`, fields);
  }

  // Allowlisted write: create an ad. `status` is always PAUSED — there is no
  // parameter to change it; activating is a separate allowlisted write.
  // Note: verified live that validate_only on /ads returns {"success":true} and
  // creates nothing — but /copies IGNORES validate_only and really creates, so
  // never rely on validate_only for any other endpoint.
  async createAd(
    accountId: string,
    options: { name: string; adsetId: string; creative: Record<string, unknown>; validateOnly?: boolean },
  ): Promise<unknown> {
    if (!/^act_\d+$/.test(accountId)) throw new Error("createAd expects an act_<digits> account id");
    const fields: Record<string, string> = {
      name: options.name,
      adset_id: options.adsetId,
      creative: JSON.stringify(options.creative),
      status: "PAUSED",
    };
    if (options.validateOnly) fields.execution_options = JSON.stringify(["validate_only"]);
    return this.post(`/${accountId}/ads`, fields);
  }

  // Shared POST plumbing for the allowlisted writes above — private on purpose;
  // there is no public generic post/request method. Applies the call ceiling and
  // usage guard, journals with method POST and runs the shared error handling.
  private async post(path: string, params: Record<string, string>, body?: URLSearchParams | FormData): Promise<{ status: number; body: unknown }> {
    assertNotDestructive("POST", params);
    if (this.calls >= this.maxCalls) throw new Error("call ceiling reached");
    if (this.maxUsagePercent >= 90) throw new Error(`Meta usage at ${this.maxUsagePercent}%; stopping`);
    this.calls++;

    const journalBase = { method: "POST" as const, path, params, status: null as number | null, usage: null as MetaAdsCallJournalEntry["usage"] };
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}` };
    const payload = body ?? new URLSearchParams(params).toString();
    if (typeof payload === "string") headers["Content-Type"] = "application/x-www-form-urlencoded";

    let response: Response;
    try {
      response = await this.fetchFn(`${API}${path}`, { method: "POST", headers, body: payload });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      await this.journal?.({ ...journalBase, error: message });
      throw cause;
    }

    return this.finish(response, journalBase, `Meta POST ${path}`);
  }

  private async finish(
    response: Response,
    journalBase: {
      method: "GET" | "POST";
      path: string;
      params: Params;
      status: number | null;
      usage: MetaAdsCallJournalEntry["usage"];
    },
    label: string,
  ): Promise<{ status: number; body: unknown }> {
    const parsedUsage = parseUsage(response.headers);
    this.maxUsagePercent = Math.max(this.maxUsagePercent, parsedUsage.maxPercent);
    let text: string;
    try {
      text = await response.text();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      await this.journal?.({ ...journalBase, status: response.status, usage: parsedUsage.usage as MetaAdsCallJournalEntry["usage"], error: message });
      throw cause;
    }
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = text;
    }
    const failure = errorMessage(response.status, body);
    await this.journal?.({
      ...journalBase,
      status: response.status,
      usage: parsedUsage.usage as MetaAdsCallJournalEntry["usage"],
      ...(failure ? { error: failure } : {}),
    });
    if (failure) throw new Error(`${label}: ${failure}`);
    return { status: response.status, body };
  }

  async getAll<T>(path: string, params: Params = {}): Promise<T[]> {
    const rows: T[] = [];
    let after: string | undefined;
    for (;;) {
      const pageParams = { ...params };
      if (after) pageParams.after = after;
      const page = await this.get<ApiPage<T>>(path, pageParams);
      rows.push(...(page.data ?? []));
      if (!page.paging?.next || !page.paging.cursors?.after) return rows;
      after = page.paging.cursors.after;
    }
  }
}
