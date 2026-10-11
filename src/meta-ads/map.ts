import type { Json, MetaAdsAdDailyBreakdownInsert, MetaAdsAdDailyInsert, MetaAdsAdInsert, MetaAdsAdsetInsert, MetaAdsCampaignInsert, MetaAdsCreativeInsert } from "../db/types.ts";
import type { ActionTypeConfig, ApiObject } from "./types.ts";

const DEFAULT_ACTION_TYPES = {
  installs: ["mobile_app_install", "omni_app_install"],
  trials: ["app_custom_event.fb_mobile_start_trial", "start_trial_mobile_app", "omni_start_trial"],
  purchases: ["app_custom_event.fb_mobile_purchase", "omni_purchase", "purchase"],
};

function value(row: ApiObject, key: string): string | null {
  const v = row[key];
  return v === undefined || v === null || v === "" ? null : String(v);
}

function object(value: unknown): ApiObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as ApiObject) : {};
}

function number(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function requiredNumber(row: ApiObject, key: string): number {
  return number(row[key]) ?? 0;
}

function json(value: unknown): Json | null {
  return value === undefined || value === null ? null : (value as Json);
}

function actionsFor(row: ApiObject): ApiObject[] {
  const conversions = Array.isArray(row.conversions) ? (row.conversions as ApiObject[]) : [];
  const actions = Array.isArray(row.actions) ? (row.actions as ApiObject[]) : [];
  return [...conversions, ...actions];
}

function firstActionCount(actions: ApiObject[], preferred: string[]): number | null {
  for (const type of preferred) {
    const action = actions.find((item) => item.action_type === type);
    if (action) return number(action.value);
  }
  return null;
}

function summedActionCount(actions: ApiObject[], type: string): number | null {
  const matches = actions.filter((item) => item.action_type === type);
  if (!matches.length) return null;
  return matches.reduce((total, item) => total + (number(item.value) ?? 0), 0);
}

function actionCounts(row: ApiObject, config: ActionTypeConfig = {}) {
  const actions = actionsFor(row);
  return {
    installs: firstActionCount(actions, config.installs ?? DEFAULT_ACTION_TYPES.installs),
    trials: firstActionCount(actions, config.trials ?? DEFAULT_ACTION_TYPES.trials),
    purchases: firstActionCount(actions, config.purchases ?? DEFAULT_ACTION_TYPES.purchases),
  };
}

function budget(row: ApiObject, key: string): number | null {
  return number(row[key]);
}

export function campaignRow(c: ApiObject, productId: string, trackedSourceId: string, accountId: string, currency: string, syncedAt: string): MetaAdsCampaignInsert {
  return {
    id: String(c.id),
    product_id: productId,
    tracked_source_id: trackedSourceId,
    ad_account_id: accountId,
    name: String(c.name ?? ""),
    objective: value(c, "objective"),
    status: String(c.status ?? "UNKNOWN"),
    effective_status: value(c, "effective_status"),
    daily_budget: budget(c, "daily_budget"),
    lifetime_budget: budget(c, "lifetime_budget"),
    currency,
    bid_strategy: value(c, "bid_strategy"),
    meta_created_at: value(c, "created_time"),
    meta_updated_at: value(c, "updated_time"),
    raw: c as Json,
    last_synced_at: syncedAt,
  };
}

export function adsetRow(s: ApiObject, syncedAt: string): MetaAdsAdsetInsert {
  return {
    id: String(s.id),
    campaign_id: String(s.campaign_id),
    name: String(s.name ?? ""),
    status: String(s.status ?? "UNKNOWN"),
    effective_status: value(s, "effective_status"),
    optimization_goal: value(s, "optimization_goal"),
    billing_event: value(s, "billing_event"),
    bid_amount: budget(s, "bid_amount"),
    daily_budget: budget(s, "daily_budget"),
    lifetime_budget: budget(s, "lifetime_budget"),
    targeting: json(s.targeting),
    promoted_object: json(s.promoted_object),
    learning_stage_info: json(s.learning_stage_info),
    is_skadnetwork_attribution: typeof s.is_skadnetwork_attribution === "boolean" ? s.is_skadnetwork_attribution : null,
    raw: s as Json,
    last_synced_at: syncedAt,
  };
}

export function creativeRow(c: ApiObject, productId: string, accountId: string, syncedAt: string): MetaAdsCreativeInsert {
  const story = object(c.object_story_spec);
  const video = object(story.video_data);
  const link = object(story.link_data);
  const videoCallToAction = object(video.call_to_action);
  const linkCallToAction = object(link.call_to_action);
  return {
    id: String(c.id),
    product_id: productId,
    ad_account_id: accountId,
    video_id: value(c, "video_id") ?? value(video, "video_id"),
    image_hash: value(c, "image_hash") ?? value(video, "image_hash") ?? value(link, "image_hash"),
    thumbnail_url: value(c, "thumbnail_url"),
    body: value(c, "body") ?? value(video, "message") ?? value(link, "message"),
    title: value(c, "title") ?? value(video, "title") ?? value(link, "name"),
    call_to_action_type: value(c, "call_to_action_type") ?? value(videoCallToAction, "type") ?? value(linkCallToAction, "type"),
    object_story_spec: json(c.object_story_spec),
    asset_feed_spec: json(c.asset_feed_spec),
    raw: c as Json,
    last_synced_at: syncedAt,
  };
}

export function adRow(a: ApiObject, syncedAt: string): MetaAdsAdInsert {
  const creative = a.creative && typeof a.creative === "object" ? (a.creative as ApiObject) : null;
  return {
    id: String(a.id),
    adset_id: String(a.adset_id),
    campaign_id: String(a.campaign_id),
    creative_id: value(creative ?? {}, "id"),
    name: String(a.name ?? ""),
    status: String(a.status ?? "UNKNOWN"),
    effective_status: value(a, "effective_status"),
    issues_info: json(a.issues_info),
    meta_created_at: value(a, "created_time"),
    meta_updated_at: value(a, "updated_time"),
    raw: a as Json,
    last_synced_at: syncedAt,
  };
}

function dailyMetrics(row: ApiObject, productId: string, currency: string, syncedAt: string, config: ActionTypeConfig) {
  const actions = actionsFor(row);
  const videoActions = Array.isArray(row.video_p25_watched_actions) ? (row.video_p25_watched_actions as ApiObject[]) : [];
  const video50 = Array.isArray(row.video_p50_watched_actions) ? (row.video_p50_watched_actions as ApiObject[]) : [];
  const video100 = Array.isArray(row.video_p100_watched_actions) ? (row.video_p100_watched_actions as ApiObject[]) : [];
  const thruplays = Array.isArray(row.video_thruplay_watched_actions) ? (row.video_thruplay_watched_actions as ApiObject[]) : [];
  const counts = actionCounts(row, config);
  return {
    date: String(row.date_start ?? ""),
    ad_id: String(row.ad_id),
    product_id: productId,
    campaign_id: String(row.campaign_id ?? ""),
    adset_id: String(row.adset_id ?? ""),
    impressions: requiredNumber(row, "impressions"),
    reach: number(row.reach),
    clicks: requiredNumber(row, "clicks"),
    inline_link_clicks: requiredNumber(row, "inline_link_clicks"),
    spend: requiredNumber(row, "spend"),
    currency,
    video_3s_views: summedActionCount(actions, "video_view"),
    video_p25: summedActionCount(videoActions, "video_view"),
    video_p50: summedActionCount(video50, "video_view"),
    video_p100: summedActionCount(video100, "video_view"),
    thruplays: summedActionCount(thruplays, "video_view"),
    installs: counts.installs,
    trials: counts.trials,
    purchases: counts.purchases,
    actions: json(row.actions),
    cost_per_action_type: json(row.cost_per_action_type),
    quality_ranking: value(row, "quality_ranking"),
    engagement_rate_ranking: value(row, "engagement_rate_ranking"),
    conversion_rate_ranking: value(row, "conversion_rate_ranking"),
    synced_at: syncedAt,
  };
}

export function dailyRow(row: ApiObject, productId: string, currency: string, syncedAt: string, config: ActionTypeConfig = {}): MetaAdsAdDailyInsert {
  return dailyMetrics(row, productId, currency, syncedAt, config);
}

export function breakdownRow(row: ApiObject, productId: string, currency: string, syncedAt: string, config: ActionTypeConfig = {}): MetaAdsAdDailyBreakdownInsert {
  const metrics = dailyMetrics(row, productId, currency, syncedAt, config);
  return {
    date: metrics.date,
    ad_id: metrics.ad_id,
    breakdown: "country",
    value: String(row.country ?? ""),
    product_id: productId,
    campaign_id: metrics.campaign_id,
    impressions: metrics.impressions,
    clicks: metrics.clicks,
    spend: metrics.spend,
    currency,
    installs: metrics.installs,
    trials: metrics.trials,
    purchases: metrics.purchases,
    actions: metrics.actions,
    synced_at: syncedAt,
  };
}

export { DEFAULT_ACTION_TYPES };
