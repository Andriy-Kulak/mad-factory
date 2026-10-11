import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTranscript, transcribePosts, type PostVideo, type TranscribeDeps } from "./transcribe.ts";
import type { ProductRow } from "../db/types.ts";

function deps(videos: PostVideo[], replies: Record<string, string>) {
  const saved: [string, string][] = [];
  const logs: string[] = [];
  const d: TranscribeDeps = {
    requireProduct: async (slug) => ({ id: "p1", slug } as ProductRow),
    listUntranscribed: async () => videos,
    download: async (url) => Buffer.from(url),
    complete: async (messages) => {
      const part = (messages[0]!.content as { type: string; file?: { file_data: string } }[])[1]!;
      const url = Buffer.from(part.file!.file_data.split(",")[1]!, "base64").toString();
      if (!(url in replies)) throw new Error("boom");
      return { content: replies[url]!, usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } };
    },
    saveTranscript: async (id, t) => { saved.push([id, t]); },
    log: (m) => logs.push(m),
  };
  return { d, saved, logs };
}

const video = (id: string, bytes = 1000): PostVideo => ({ postId: id, sha256: `sha-${id}`, publicUrl: `u-${id}`, bytes });

test("transcribePosts saves transcripts, marks silent videos, skips big files and counts tokens", async () => {
  const { d, saved } = deps([video("a"), video("b"), video("c", 30 * 1024 * 1024), video("d")], {
    "u-a": '```json\n{"transcript": " Hello there "}\n```',
    "u-b": '{"transcript": ""}',
  });
  const stats = await transcribePosts("x", { model: "m", concurrency: 2, dryRun: false }, d);
  assert.deepEqual(saved.sort(), [["a", "Hello there"], ["b", ""]]);
  assert.deepEqual(stats, { selected: 4, transcribed: 1, silent: 1, skipped: 1, failures: 1, promptTokens: 200, outputTokens: 20 });
});

test("transcribePosts honors --limit and --dry-run", async () => {
  const { d, saved } = deps([video("a"), video("b")], { "u-a": '{"transcript": "hi"}', "u-b": '{"transcript": "yo"}' });
  const stats = await transcribePosts("x", { limit: 1, model: "m", concurrency: 3, dryRun: true }, d);
  assert.deepEqual(saved, []);
  assert.equal(stats.selected, 1);
  assert.equal(stats.transcribed, 1);
  assert.equal(stats.skipped, 1);
});

test("parseTranscript rejects replies without a transcript string", () => {
  assert.throws(() => parseTranscript('{"text": "hi"}'), /no transcript/);
});
