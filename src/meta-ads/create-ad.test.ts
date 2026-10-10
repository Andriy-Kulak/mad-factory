import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCreativeFromTemplate, createAdFromTemplate, type CreateAdDeps } from "./create-ad.ts";
import type { MetaAdsChangeInsert, ProductRow } from "../db/types.ts";

const TEMPLATE = {
  object_story_spec: {
    page_id: "pg1",
    instagram_user_id: "ig1",
    video_data: {
      video_id: "old-v",
      image_hash: "hash-old",
      image_url: "https://old.example/thumb.jpg",
      call_to_action: { type: "INSTALL_MOBILE_APP", value: { link: "https://store.example" } },
    },
  },
  asset_feed_spec: {
    bodies: [{ text: "Body one" }, { text: "Body two" }],
    titles: [{ text: "Title one" }, { text: "Title two" }],
    optimization_type: "DEGREES_OF_FREEDOM",
  },
  degrees_of_freedom_spec: { creative_features_spec: { standard_enhancements: { enroll_status: "OPT_OUT" } } },
};

test("buildCreativeFromTemplate feed mode keeps asset_feed_spec and drops image_hash", () => {
  const creative = buildCreativeFromTemplate(TEMPLATE, { media: { kind: "video", videoId: "v9", thumbnailUrl: "https://t.example/t.jpg" }, textMode: "feed" }) as {
    object_story_spec: { page_id: string; instagram_user_id: string; video_data: Record<string, unknown> };
    asset_feed_spec: { bodies: { text: string }[] };
  };
  const videoData = creative.object_story_spec.video_data;
  assert.equal(videoData.video_id, "v9");
  assert.equal(videoData.image_url, "https://t.example/t.jpg");
  assert.equal(videoData.image_hash, undefined);
  assert.equal(creative.object_story_spec.page_id, "pg1");
  assert.equal(creative.object_story_spec.instagram_user_id, "ig1");
  assert.deepEqual(videoData.call_to_action, { type: "INSTALL_MOBILE_APP", value: { link: "https://store.example" } });
  assert.equal(creative.asset_feed_spec.bodies.length, 2);
});

test("buildCreativeFromTemplate single mode collapses text onto the video", () => {
  const creative = buildCreativeFromTemplate(TEMPLATE, { media: { kind: "video", videoId: "v9", thumbnailUrl: null }, textMode: "single" }) as {
    object_story_spec: { video_data: Record<string, unknown> };
    asset_feed_spec?: unknown;
  };
  const videoData = creative.object_story_spec.video_data;
  assert.equal(videoData.message, "Body one");
  assert.equal(videoData.title, "Title one");
  assert.equal(videoData.image_url, undefined);
  assert.equal(creative.asset_feed_spec, undefined);
});

function harness(objects: Record<string, Record<string, unknown>>) {
  const events: string[] = [];
  const changes: MetaAdsChangeInsert[] = [];
  const created: Record<string, unknown>[] = [];
  const client = {
    async get<T = unknown>(path: string): Promise<T> {
      events.push(`get ${path}`);
      const object = objects[path.slice(1)];
      if (!object) throw new Error(`unknown ${path}`);
      return object as T;
    },
    async uploadVideo(_account: string, _file: string, _title: string) {
      events.push("uploadVideo");
      return { videoId: "v-new", thumbnailUrl: "https://t.example/new.jpg" };
    },
    async uploadImage(_account: string, _file: string) {
      events.push("uploadImage");
      return { hash: "h-new" };
    },
    async videoThumbnail(videoId: string) {
      events.push(`thumb ${videoId}`);
      return videoId === "v-thumb" ? "https://t.example/v.jpg" : null;
    },
    async createAd(_account: string, options: Record<string, unknown>) {
      events.push("createAd");
      created.push(options);
      return { status: 200, body: { id: "ad-new" } };
    },
  };
  const deps: CreateAdDeps = {
    async requireProduct() { return { id: "p1", slug: "acme" } as ProductRow; },
    async adAccount() { return "act_999"; },
    async requirePlanDoc(_productId: string, ref: string) { return ref.split("/").pop()!.replace(/\.(?:md|json)$/i, ""); },
    async insertChange(row) { changes.push(row); events.push(`insert ${row.object_type}`); return `change-${changes.length}`; },
    async updateChange() {},
    log() {},
  };
  return { client, deps, events, changes, created };
}

const OBJECTS = {
  as1: { name: "Ad set", account_id: "999" },
  tpl: { name: "Template ad", account_id: "999", creative: TEMPLATE },
};

const OPTS = { adsetId: "as1", templateAdId: "tpl", name: "New ad", plan: "plan.md", validateOnly: false, textMode: "feed" as const };

test("createAdFromTemplate refuses a foreign ad set before any write", async () => {
  const { client, deps, changes, created } = harness({ ...OBJECTS, as1: { name: "Ad set", account_id: "777" } });
  await assert.rejects(createAdFromTemplate(client, "acme", { ...OPTS, videoId: "v1" }, deps), /belongs to act_777/);
  assert.equal(changes.length, 0);
  assert.equal(created.length, 0);
});

test("createAdFromTemplate journals the upload and create before each write", async () => {
  const { client, deps, events, changes } = harness(OBJECTS);
  const result = await createAdFromTemplate(client, "acme", { ...OPTS, file: "/tmp/ad.mp4" }, deps);
  assert.equal(result.adId, "ad-new");
  assert.equal(result.videoId, "v-new");
  assert.ok(events.indexOf("insert video") < events.indexOf("uploadVideo"));
  assert.ok(events.indexOf("insert ad") < events.indexOf("createAd"));
  assert.equal(changes[0]!.object_type, "video");
  assert.equal(changes[1]!.object_type, "ad");
  assert.equal(changes[1]!.is_write, true);
});

test("the --video-id path fetches a thumbnail into video_data.image_url", async () => {
  const { client, deps, events, created } = harness(OBJECTS);
  await createAdFromTemplate(client, "acme", { ...OPTS, videoId: "v-thumb" }, deps);
  const videoData = (created[0]!.creative as { object_story_spec: { video_data: { image_url?: string } } }).object_story_spec.video_data;
  assert.equal(videoData.image_url, "https://t.example/v.jpg");
  assert.ok(events.includes("thumb v-thumb"));
});

test("a missing thumbnail throws before any create journal row", async () => {
  const { client, deps, changes, created } = harness(OBJECTS);
  await assert.rejects(
    createAdFromTemplate(client, "acme", { ...OPTS, videoId: "v-none" }, deps),
    /no thumbnail for video v-none/,
  );
  assert.equal(changes.filter((row) => row.object_type === "ad").length, 0);
  assert.equal(created.length, 0);
});

test("createAdFromTemplate needs exactly one of file or videoId", async () => {
  const { client, deps } = harness(OBJECTS);
  await assert.rejects(createAdFromTemplate(client, "acme", { ...OPTS }, deps), /exactly one/);
});

test("buildCreativeFromTemplate strips standard_enhancements, keeps other features, never mutates", () => {
  // Meta rejects new creatives carrying standard_enhancements (subcode 3858504).
  const template = {
    object_story_spec: { page_id: "pg1", video_data: { video_id: "v" } },
    degrees_of_freedom_spec: {
      creative_features_spec: {
        standard_enhancements: { enroll_status: "OPT_IN" },
        text_optimizations: { enroll_status: "OPT_OUT" },
      },
    },
  };
  const creative = buildCreativeFromTemplate(template, { media: { kind: "video", videoId: "v9", thumbnailUrl: null }, textMode: "feed" }) as {
    degrees_of_freedom_spec: { creative_features_spec: Record<string, unknown> };
  };
  const features = creative.degrees_of_freedom_spec.creative_features_spec;
  assert.equal(features.standard_enhancements, undefined);
  assert.deepEqual(features.text_optimizations, { enroll_status: "OPT_OUT" });
  const original = template.degrees_of_freedom_spec.creative_features_spec;
  assert.deepEqual(original.standard_enhancements, { enroll_status: "OPT_IN" });
});

test("text override replaces asset_feed_spec in feed mode", () => {
  const creative = buildCreativeFromTemplate(TEMPLATE, {
    media: { kind: "video", videoId: "v9", thumbnailUrl: null }, textMode: "feed",
    text: { titles: ["New title"], bodies: ["New body"] },
  }) as { asset_feed_spec: { titles: { text: string }[]; bodies: { text: string }[]; optimization_type: string } };
  assert.deepEqual(creative.asset_feed_spec.titles, [{ text: "New title" }]);
  assert.deepEqual(creative.asset_feed_spec.bodies, [{ text: "New body" }]);
  assert.equal(creative.asset_feed_spec.optimization_type, "DEGREES_OF_FREEDOM");
});

test("text override sets video_data title/message in single mode", () => {
  const creative = buildCreativeFromTemplate(TEMPLATE, {
    media: { kind: "video", videoId: "v9", thumbnailUrl: null }, textMode: "single",
    text: { titles: ["New title"], bodies: ["New body"] },
  }) as { object_story_spec: { video_data: { title?: string; message?: string } } };
  assert.equal(creative.object_story_spec.video_data.title, "New title");
  assert.equal(creative.object_story_spec.video_data.message, "New body");
});

test("--title without --body errors", async () => {
  const { client, deps } = harness(OBJECTS);
  await assert.rejects(
    createAdFromTemplate(client, "acme", { ...OPTS, videoId: "v-thumb", titles: ["t"] }, deps),
    /together/,
  );
});

test("buildCreativeFromTemplate image media builds link_data from the video template's CTA", () => {
  const creative = buildCreativeFromTemplate(TEMPLATE, {
    media: { kind: "image", imageHash: "hash1" }, textMode: "feed",
  }) as { object_story_spec: { link_data: Record<string, unknown>; video_data?: unknown }; asset_feed_spec: { titles: unknown[] } };
  const link = creative.object_story_spec.link_data;
  assert.equal(link.link, "https://store.example");
  assert.equal(link.image_hash, "hash1");
  assert.deepEqual(link.call_to_action, { type: "INSTALL_MOBILE_APP", value: { link: "https://store.example" } });
  assert.equal(creative.object_story_spec.video_data, undefined);
  assert.equal(creative.asset_feed_spec.titles.length, 2);
});

test("buildCreativeFromTemplate image single mode sets message/name, and throws with no link", () => {
  const creative = buildCreativeFromTemplate(TEMPLATE, {
    media: { kind: "image", imageHash: "hash1" }, textMode: "single",
  }) as { object_story_spec: { link_data: Record<string, unknown> } };
  assert.equal(creative.object_story_spec.link_data.message, "Body one");
  assert.equal(creative.object_story_spec.link_data.name, "Title one");
  const noLink = { object_story_spec: { page_id: "pg1", video_data: { video_id: "v" } } };
  assert.throws(() => buildCreativeFromTemplate(noLink, { media: { kind: "image", imageHash: "h" }, textMode: "feed" }), /no link/);
});

test("file extension routes to uploadImage or uploadVideo, gif throws", async () => {
  const { client, deps, events } = harness(OBJECTS);
  await createAdFromTemplate(client, "acme", { ...OPTS, file: "/tmp/ad.png" }, deps);
  await createAdFromTemplate(client, "acme", { ...OPTS, file: "/tmp/ad.mp4" }, deps);
  assert.deepEqual(events.filter((e) => e.startsWith("upload")), ["uploadImage", "uploadVideo"]);
  await assert.rejects(createAdFromTemplate(client, "acme", { ...OPTS, file: "/tmp/ad.gif" }, deps), /unsupported media extension/);
});
