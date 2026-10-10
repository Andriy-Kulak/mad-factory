import { test } from "node:test";
import assert from "node:assert/strict";
import { MetaAdsClient } from "./client.ts";
import { downloadMedia, importMediaFile, type MediaDeps } from "./media.ts";
import { sha256 } from "../lib/storage.ts";
import type { CreativeInsert, MetaAdsCreativeRow } from "../db/types.ts";

function withEnv<T>(values: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return fn().finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function creative(id: string, videoId: string | null, imageHash: string | null): MetaAdsCreativeRow {
  return {
    id,
    product_id: "p1",
    ad_account_id: "act_1",
    video_id: videoId,
    image_hash: imageHash,
    thumbnail_url: null,
    body: null,
    title: null,
    call_to_action_type: null,
    object_story_spec: null,
    asset_feed_spec: null,
    attributes: {},
    sha256: null,
    raw: {},
    last_synced_at: "",
  };
}

interface Harness {
  deps: MediaDeps;
  stored: { hash: string; ext: string; prefix: string; type: string }[];
  linked: { id: string; hash: string }[];
  downloads: string[];
}

function harness(creatives: MetaAdsCreativeRow[]): Harness {
  const state = {
    stored: [] as Harness["stored"],
    linked: [] as Harness["linked"],
    downloads: [] as string[],
    known: new Set<string>(),
    storeCalls: new Map<string, { ext: string; prefix: string }>(),
  };
  const deps: MediaDeps = {
    listCreatives: async () => creatives,
    getCreative: async (productId, creativeId) =>
      creatives.find((row) => row.product_id === productId && row.id === creativeId) ?? null,
    setCreativeSha: async (id, hash) => { state.linked.push({ id, hash }); },
    creativeExists: async (hash) => state.known.has(hash),
    insertCreative: async (row: CreativeInsert) => {
      state.known.add(row.sha256);
      const call = state.storeCalls.get(row.sha256);
      state.stored.push({ hash: row.sha256, ext: call!.ext, prefix: call!.prefix, type: String(row.media_type) });
    },
    download: async (url) => {
      state.downloads.push(url);
      return Buffer.from(`bytes:${url}`);
    },
    readFile: async (path) => Buffer.from(`file:${path}`),
    store: async (hash, _buf, ext, prefix) => {
      state.storeCalls.set(hash, { ext, prefix });
      return { storageKey: `${prefix}/${hash}.${ext}`, publicUrl: null };
    },
    log: () => {},
  };
  return { deps, stored: state.stored, linked: state.linked, downloads: state.downloads };
}

test("video creatives download the video source once per video_id", async () => withEnv(
  { META_ADS_TOKEN: "read-secret" },
  async () => {
    const rows = [creative("c1", "v1", "thumb-hash"), creative("c2", "v1", null), creative("c3", "v2", null)];
    const { deps, stored, linked, downloads } = harness(rows);
    const requested: string[] = [];
    const client = new MetaAdsClient({}, (async (input) => {
      const url = new URL(String(input));
      const videoId = url.pathname.replace(/^\/v[0-9.]+\//, "");
      requested.push(`/${videoId}`);
      return new Response(JSON.stringify({ source: `https://cdn/${videoId}.mp4` }));
    }) as typeof fetch);

    const stats = await downloadMedia(client, "act_1", "p1", {}, deps);
    assert.equal(stats.videos, 2);
    assert.equal(stats.failures, 0);
    assert.deepEqual(requested.sort(), ["/v1", "/v2"]);
    assert.deepEqual(downloads.sort(), ["https://cdn/v1.mp4", "https://cdn/v2.mp4"]);
    assert.equal(stored.length, 2);
    assert.ok(stored.every((item) => item.type === "video" && item.prefix === "videos" && item.ext === "mp4"));
    // Both creatives sharing v1 get the same sha256.
    assert.equal(linked.length, 3);
    assert.equal(linked.find((l) => l.id === "c1")!.hash, linked.find((l) => l.id === "c2")!.hash);
  },
));

test("image-only creatives are resolved with one batched adimages call", async () => withEnv(
  { META_ADS_TOKEN: "read-secret" },
  async () => {
    const rows = [creative("c1", null, "h1"), creative("c2", null, "h2"), creative("c3", null, "h1")];
    const { deps, stored, linked } = harness(rows);
    const calls: { path: string; params: URLSearchParams }[] = [];
    const client = new MetaAdsClient({}, (async (input) => {
      const url = new URL(String(input));
      calls.push({ path: url.pathname, params: url.searchParams });
      assert.ok(url.pathname.endsWith("/act_1/adimages"));
      const hashes = JSON.parse(url.searchParams.get("hashes")!) as string[];
      return new Response(JSON.stringify({
        data: hashes.map((hash) => ({ hash, url: `https://cdn/${hash}.jpg` })),
      }));
    }) as typeof fetch);

    const stats = await downloadMedia(client, "act_1", "p1", {}, deps);
    assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(calls[0]!.params.get("hashes")!).sort(), ["h1", "h2"]);
    assert.equal(calls[0]!.params.get("fields"), "hash,url");
    assert.equal(stats.images, 2);
    assert.equal(stored.length, 2);
    assert.ok(stored.every((item) => item.type === "image" && item.prefix === "images" && item.ext === "jpg"));
    assert.equal(linked.length, 3);
    assert.equal(linked.find((l) => l.id === "c1")!.hash, linked.find((l) => l.id === "c3")!.hash);
  },
));

test("video wins over image_hash and one failure does not stop the rest", async () => withEnv(
  { META_ADS_TOKEN: "read-secret" },
  async () => {
    const rows = [
      creative("c1", "v-ok", "h-ignored"),
      creative("c2", "v-bad", null),
      creative("c3", null, "h-ok"),
      creative("c4", null, null),
    ];
    const { deps, linked } = harness(rows);
    const client = new MetaAdsClient({}, (async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/v-bad")) {
        return new Response(JSON.stringify({ error: { code: 10, message: "no permission" } }), { status: 400 });
      }
      if (url.pathname.endsWith("/v-ok")) return new Response(JSON.stringify({ source: "https://cdn/v.mp4" }));
      return new Response(JSON.stringify({ data: [{ hash: "h-ok", url: "https://cdn/h.jpg" }] }));
    }) as typeof fetch);

    const stats = await downloadMedia(client, "act_1", "p1", {}, deps);
    assert.equal(stats.videos, 1);
    assert.equal(stats.images, 1);
    assert.equal(stats.failures, 1);
    assert.equal(stats.skipped, 1);
    assert.deepEqual(linked.map((l) => l.id).sort(), ["c1", "c3"]);
  },
));

test("importMediaFile stores a new file and links the creative", async () => {
  const { deps, stored, linked } = harness([creative("c1", "v1", "thumb")]);
  await importMediaFile("p1", "c1", "/tmp/ad.mov", {}, deps);
  const hash = sha256(Buffer.from("file:/tmp/ad.mov"));
  assert.equal(stored.length, 1);
  assert.equal(stored[0]!.ext, "mov");
  assert.equal(stored[0]!.prefix, "videos");
  assert.equal(stored[0]!.type, "video");
  assert.deepEqual(linked, [{ id: "c1", hash }]);
});

test("importMediaFile links without re-storing when the hash already exists", async () => {
  const { deps, stored, linked } = harness([creative("c1", "v1", null), creative("c2", "v2", null)]);
  await importMediaFile("p1", "c1", "/tmp/ad.mp4", {}, deps);
  await importMediaFile("p1", "c2", "/tmp/ad.mp4", {}, deps);
  assert.equal(stored.length, 1);
  assert.equal(linked.length, 2);
  assert.equal(linked[0]!.hash, linked[1]!.hash);
});

test("importMediaFile rejects an unknown creative id", async () => {
  const { deps } = harness([creative("c1", "v1", null)]);
  await assert.rejects(() => importMediaFile("p1", "nope", "/tmp/ad.mp4", {}, deps), /not found/);
});

test("importMediaFile refuses a different existing sha unless forced", async () => {
  const row = creative("c1", "v1", null);
  row.sha256 = "other-hash";
  const { deps } = harness([row]);
  await assert.rejects(() => importMediaFile("p1", "c1", "/tmp/ad.mp4", {}, deps), /already has sha256/);
  await importMediaFile("p1", "c1", "/tmp/ad.mp4", { force: true }, deps);
});

test("importMediaFile rejects unsupported extensions and maps jpeg to jpg", async () => {
  const { deps, stored } = harness([creative("c1", "v1", null), creative("c2", "v2", null)]);
  await assert.rejects(() => importMediaFile("p1", "c1", "/tmp/ad.gif", {}, deps), /unsupported file extension/);
  await importMediaFile("p1", "c2", "/tmp/photo.jpeg", {}, deps);
  assert.equal(stored[0]!.ext, "jpg");
  assert.equal(stored[0]!.prefix, "images");
});
