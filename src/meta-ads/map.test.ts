import { test } from "node:test";
import assert from "node:assert/strict";
import { adRow, adsetRow, breakdownRow, campaignRow, creativeRow, dailyRow } from "./map.ts";

test("maps structural objects and parses string budgets", () => {
  const campaign = campaignRow({ id: "cmp_1", name: "campaign", status: "ACTIVE", daily_budget: "2500", lifetime_budget: "5000" }, "product-id", "source-id", "act_123", "USD", "synced");
  assert.equal(campaign.id, "cmp_1");
  assert.equal(campaign.daily_budget, 2500);
  assert.equal(campaign.lifetime_budget, 5000);
  assert.equal(campaign.ad_account_id, "act_123");
  assert.deepEqual(campaign.raw, { id: "cmp_1", name: "campaign", status: "ACTIVE", daily_budget: "2500", lifetime_budget: "5000" });
  assert.equal(campaignRow({ id: "cmp_2", daily_budget: "not-a-number" }, "p", "s", "act_123", "USD", "t").daily_budget, null);

  assert.deepEqual(adsetRow({ id: "set_1", campaign_id: "cmp_1", name: "set", status: "PAUSED", bid_amount: "10" }, "t"), {
    id: "set_1",
    campaign_id: "cmp_1",
    name: "set",
    status: "PAUSED",
    effective_status: null,
    optimization_goal: null,
    billing_event: null,
    bid_amount: 10,
    daily_budget: null,
    lifetime_budget: null,
    targeting: null,
    promoted_object: null,
    learning_stage_info: null,
    is_skadnetwork_attribution: null,
    raw: { id: "set_1", campaign_id: "cmp_1", name: "set", status: "PAUSED", bid_amount: "10" },
    last_synced_at: "t",
  });
  assert.equal(creativeRow({ id: "cr_1", title: "headline" }, "p", "act_123", "t").title, "headline");
  assert.equal(adRow({ id: "ad_1", adset_id: "set_1", campaign_id: "cmp_1", creative: { id: "cr_1" } }, "t").creative_id, "cr_1");
});

test("maps creative fields from video story specs", () => {
  const creative = creativeRow(
    {
      id: "cr_video",
      object_story_spec: {
        video_data: {
          message: "video body",
          title: "video title",
          video_id: "vid_1",
          image_hash: "video_image",
          call_to_action: { type: "WATCH_MORE" },
        },
      },
    },
    "p",
    "act_123",
    "t",
  );

  assert.deepEqual([creative.body, creative.title, creative.video_id, creative.image_hash, creative.call_to_action_type], ["video body", "video title", "vid_1", "video_image", "WATCH_MORE"]);
});

test("maps creative fields from link story specs", () => {
  const creative = creativeRow(
    {
      id: "cr_link",
      object_story_spec: {
        link_data: {
          message: "link body",
          name: "link title",
          image_hash: "link_image",
          call_to_action: { type: "SIGN_UP" },
        },
      },
    },
    "p",
    "act_123",
    "t",
  );

  assert.deepEqual([creative.body, creative.title, creative.video_id, creative.image_hash, creative.call_to_action_type], ["link body", "link title", null, "link_image", "SIGN_UP"]);
});

test("top-level creative fields take precedence over story specs", () => {
  const creative = creativeRow(
    {
      id: "cr_top",
      body: "top body",
      title: "top title",
      video_id: "top_video",
      image_hash: "top_image",
      call_to_action_type: "TOP_ACTION",
      object_story_spec: {
        video_data: {
          message: "video body",
          title: "video title",
          video_id: "video_id",
          image_hash: "video_image",
          call_to_action: { type: "VIDEO_ACTION" },
        },
        link_data: {
          message: "link body",
          name: "link title",
          image_hash: "link_image",
          call_to_action: { type: "LINK_ACTION" },
        },
      },
    },
    "p",
    "act_123",
    "t",
  );

  assert.deepEqual([creative.body, creative.title, creative.video_id, creative.image_hash, creative.call_to_action_type], ["top body", "top title", "top_video", "top_image", "TOP_ACTION"]);
});

test("creativeRow never sets sha256 so sync upserts leave a filled sha256 untouched", () => {
  const creative = creativeRow(
    {
      id: "cr_1",
      video_id: "v1",
      image_hash: "h1",
      object_story_spec: { video_data: { video_id: "v1" } },
    },
    "p",
    "act_123",
    "t",
  );
  assert.equal("sha256" in creative, false);
});

test("uses the first configured action type present, without summing action types", () => {
  const daily = dailyRow(
    {
      date_start: "2026-01-01",
      ad_id: "ad_1",
      campaign_id: "cmp_1",
      adset_id: "set_1",
      actions: [
        { action_type: "omni_app_install", value: "9" },
        { action_type: "mobile_app_install", value: "2" },
        { action_type: "app_custom_event.fb_mobile_start_trial", value: "3" },
        { action_type: "start_trial_mobile_app", value: "7" },
        { action_type: "purchase", value: "11" },
      ],
    },
    "product-id",
    "USD",
    "synced",
  );
  assert.equal(daily.installs, 2);
  assert.equal(daily.trials, 3);
  assert.equal(daily.purchases, 11);

  const configured = dailyRow(
    {
      date_start: "2026-01-01",
      ad_id: "ad_1",
      actions: [{ action_type: "custom_trial", value: "4" }],
    },
    "product-id",
    "USD",
    "synced",
    { trials: ["custom_trial"] },
  );
  assert.equal(configured.trials, 4);
});

test("maps trials from conversions without double-counting total conversions", () => {
  const insight = {
    date_start: "2026-01-01",
    ad_id: "ad_1",
    conversions: [
      { action_type: "start_trial_mobile_app", value: "17" },
      { action_type: "start_trial_total", value: "17" },
    ],
  };
  const daily = dailyRow(insight, "product-id", "USD", "synced");
  assert.equal(daily.trials, 17);
  assert.equal(daily.actions, null);

  const breakdown = breakdownRow(insight, "product-id", "USD", "synced");
  assert.equal(breakdown.trials, 17);
  assert.equal(breakdown.actions, null);
});

test("conversions take precedence over actions for the same action type", () => {
  const actions = [{ action_type: "start_trial_mobile_app", value: "9" }];
  const daily = dailyRow(
    {
      date_start: "2026-01-01",
      ad_id: "ad_1",
      conversions: [{ action_type: "start_trial_mobile_app", value: "17" }],
      actions,
    },
    "product-id",
    "USD",
    "synced",
  );

  assert.equal(daily.trials, 17);
  assert.deepEqual(daily.actions, actions);
});

test("maps video actions, standard metrics, and country breakdown", () => {
  const insight = {
    date_start: "2026-01-01",
    ad_id: "ad_1",
    campaign_id: "cmp_1",
    adset_id: "set_1",
    country: "US",
    impressions: "100",
    reach: "90",
    clicks: "8",
    inline_link_clicks: "6",
    spend: "1.2500",
    actions: [
      { action_type: "video_view", value: "12" },
      { action_type: "mobile_app_install", value: "2" },
      { action_type: "app_custom_event.fb_mobile_start_trial", value: "1" },
    ],
    video_p25_watched_actions: [
      { action_type: "video_view", value: "10" },
      { action_type: "video_view", value: "2" },
    ],
    video_p50_watched_actions: [{ action_type: "video_view", value: "8" }],
    video_p100_watched_actions: [{ action_type: "video_view", value: "4" }],
    video_thruplay_watched_actions: [{ action_type: "video_view", value: "5" }],
    cost_per_action_type: [{ action_type: "mobile_app_install", value: "0.625" }],
  };
  const daily = dailyRow(insight, "product-id", "USD", "synced");
  assert.deepEqual(
    [daily.impressions, daily.reach, daily.clicks, daily.inline_link_clicks, daily.spend, daily.video_3s_views, daily.video_p25, daily.video_p50, daily.video_p100, daily.thruplays],
    [100, 90, 8, 6, 1.25, 12, 12, 8, 4, 5],
  );
  assert.equal(daily.installs, 2);
  assert.deepEqual(daily.actions, insight.actions);
  const breakdown = breakdownRow(insight, "product-id", "USD", "synced");
  assert.equal(breakdown.breakdown, "country");
  assert.equal(breakdown.value, "US");
  assert.equal(breakdown.product_id, "product-id");
  assert.equal(breakdown.installs, 2);
});
