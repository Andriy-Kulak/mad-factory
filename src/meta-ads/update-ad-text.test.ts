import { test } from "node:test";
import assert from "node:assert/strict";
import { updateAdText, type UpdateAdTextDeps } from "./update-ad-text.ts";
import type { MetaAdsChangeInsert, ProductRow } from "../db/types.ts";

const CURRENT_CREATIVE = {
  object_story_spec: {
    page_id: "pg1",
    video_data: {
      video_id: "v1",
      image_url: "https://t.example/old.jpg",
      call_to_action: { type: "INSTALL_MOBILE_APP", value: { link: "https://store.example" } },
    },
  },
  asset_feed_spec: {
    titles: [{ text: "Old title" }],
    bodies: [{ text: "Old body" }],
    optimization_type: "DEGREES_OF_FREEDOM",
  },
  degrees_of_freedom_spec: {
    creative_features_spec: { standard_enhancements: { enroll_status: "OPT_IN" }, text_optimizations: { enroll_status: "OPT_OUT" } },
  },
};

function harness(ad: Record<string, unknown>) {
  const events: string[] = [];
  const changes: MetaAdsChangeInsert[] = [];
  const sent: { creative: Record<string, unknown>; validateOnly: boolean }[] = [];
  const client = {
    async get<T = unknown>(_path: string): Promise<T> { return ad as T; },
    async videoThumbnail(videoId: string) {
      events.push(`thumb ${videoId}`);
      return "https://t.example/fallback.jpg";
    },
    async updateAdCreative(_id: string, creative: Record<string, unknown>, validateOnly: boolean) {
      sent.push({ creative, validateOnly });
      events.push("updateAdCreative");
      return { status: 200, body: { success: true } };
    },
  };
  const deps: UpdateAdTextDeps = {
    async requireProduct() { return { id: "p1", slug: "acme" } as ProductRow; },
    async adAccount() { return "act_999"; },
    async requirePlanDoc(_productId: string, ref: string) { return ref.split("/").pop()!.replace(/\.(?:md|json)$/i, ""); },
    async insertChange(row) { changes.push(row); events.push(`insert ${row.object_id}`); return `change-${changes.length}`; },
    async updateChange() {},
    log() {},
  };
  return { client, deps, events, changes, sent };
}

const AD = { name: "Ad one", account_id: "999", creative: CURRENT_CREATIVE };
const OPTS = { adId: "a1", titles: ["New title"], bodies: ["New body"], plan: "plan.md", validateOnly: false, textMode: "feed" as const };

test("updateAdText refuses a foreign ad before any write", async () => {
  const { client, deps, changes, sent } = harness({ ...AD, account_id: "777" });
  await assert.rejects(updateAdText(client, "acme", OPTS, deps), /belongs to act_777/);
  assert.equal(changes.length, 0);
  assert.equal(sent.length, 0);
});

test("updateAdText journals before the write with old text in the note", async () => {
  const { client, deps, events, changes, sent } = harness(AD);
  await updateAdText(client, "acme", OPTS, deps);
  assert.ok(events.indexOf("insert a1") < events.indexOf("updateAdCreative"));
  assert.match(changes[0]!.note ?? "", /Old title/);
  const feed = sent[0]!.creative.asset_feed_spec as { titles: { text: string }[]; bodies: { text: string }[] };
  assert.deepEqual(feed.titles, [{ text: "New title" }]);
  assert.deepEqual(feed.bodies, [{ text: "New body" }]);
  const spec = sent[0]!.creative.object_story_spec as { video_data: { video_id: string; image_url: string } };
  assert.equal(spec.video_data.video_id, "v1");
  assert.equal(spec.video_data.image_url, "https://t.example/old.jpg");
});

test("updateAdText falls back to videoThumbnail when image_url is missing", async () => {
  const creative = JSON.parse(JSON.stringify(CURRENT_CREATIVE));
  delete creative.object_story_spec.video_data.image_url;
  const { client, deps, events, sent } = harness({ ...AD, creative });
  await updateAdText(client, "acme", OPTS, deps);
  assert.ok(events.includes("thumb v1"));
  const spec = sent[0]!.creative.object_story_spec as { video_data: { image_url: string } };
  assert.equal(spec.video_data.image_url, "https://t.example/fallback.jpg");
});
