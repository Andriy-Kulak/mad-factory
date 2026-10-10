import { test } from "node:test";
import assert from "node:assert/strict";
import { completeGemini, latestFlashModel } from "./gemini.ts";
import type { ChatMessage } from "./gateway.ts";

process.env.GEMINI_API_KEY = "test-key";

function fetchWith(respond: (call: number, url: string, init?: RequestInit) => Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchFn = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return respond(calls.length, String(input), init);
  }) as typeof fetch;
  return { fetchFn, calls };
}

const videoMessages: ChatMessage[] = [
  { role: "system", content: "You are a classifier." },
  {
    role: "user",
    content: [
      { type: "text", text: "Describe this ad." },
      { type: "file", file: { filename: "ad.mp4", file_data: "data:video/mp4;base64,QUJD" } },
    ],
  },
  { role: "assistant", content: '{"partial":true}' },
  { role: "user", content: "Return full JSON." },
];

test("message conversion maps roles, system instruction and inline video data", async () => {
  const { fetchFn, calls } = fetchWith(() =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] } }] })));
  await completeGemini(videoMessages, { model: "gemini-2.5-flash" }, fetchFn);
  const call = calls[0]!;
  assert.equal(call.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
  const headers = call.init!.headers as Record<string, string>;
  assert.equal(headers["x-goog-api-key"], "test-key");
  const body = JSON.parse(String(call.init!.body));
  assert.deepEqual(body.systemInstruction, { parts: [{ text: "You are a classifier." }] });
  assert.equal(body.generationConfig.temperature, 0.2);
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.deepEqual(body.contents, [
    {
      role: "user",
      parts: [
        { text: "Describe this ad." },
        { inline_data: { mime_type: "video/mp4", data: "QUJD" } },
      ],
    },
    { role: "model", parts: [{ text: '{"partial":true}' }] },
    { role: "user", parts: [{ text: "Return full JSON." }] },
  ]);
});

test("image_url parts become inline_data too", async () => {
  const { fetchFn, calls } = fetchWith(() =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] } }] })));
  await completeGemini(
    [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/webp;base64,WFk=" } }] }],
    { model: "gemini-2.5-flash" },
    fetchFn,
  );
  const body = JSON.parse(String(calls[0]!.init!.body));
  assert.deepEqual(body.contents[0].parts, [{ inline_data: { mime_type: "image/webp", data: "WFk=" } }]);
});

test("response text parts are joined and usage maps token counts incl. thoughts", async () => {
  const { fetchFn } = fetchWith(() =>
    new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"a":' }, { text: "1}" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 7, totalTokenCount: 127 },
      }),
    ));
  const result = await completeGemini(videoMessages, { model: "gemini-2.5-flash" }, fetchFn);
  assert.equal(result.content, '{"a":1}');
  assert.deepEqual(result.usage, { prompt_tokens: 100, completion_tokens: 27, total_tokens: 127 });
});

test("non-2xx throws status plus body excerpt", async () => {
  const { fetchFn } = fetchWith(() => new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 403 }));
  await assert.rejects(() => completeGemini(videoMessages, { model: "m" }, fetchFn), /Gemini API 403: .*bad key/);
});

test("a blocked or empty response throws with reasons", async () => {
  const { fetchFn } = fetchWith(() =>
    new Response(
      JSON.stringify({ candidates: [{ finishReason: "SAFETY" }], promptFeedback: { blockReason: "OTHER" } }),
    ));
  await assert.rejects(
    () => completeGemini(videoMessages, { model: "m" }, fetchFn),
    /no text \(finishReason: SAFETY, blockReason: OTHER\)/,
  );
});

test("latestFlashModel picks the highest stable flash across pages", async () => {
  const page1 = {
    models: [
      { name: "models/gemini-2.0-flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-2.5-flash-lite", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-2.5-pro", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-2.5-flash-preview-05-20", supportedGenerationMethods: ["generateContent"] },
    ],
    nextPageToken: "p2",
  };
  const page2 = {
    models: [
      { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3-flash-preview", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-9.9-flash", supportedGenerationMethods: ["embedContent"] },
    ],
  };
  const urls: string[] = [];
  const { fetchFn } = fetchWith((n, url) => {
    urls.push(url);
    return new Response(JSON.stringify(n === 1 ? page1 : page2));
  });
  const model = await latestFlashModel(fetchFn);
  assert.equal(model, "gemini-2.5-flash");
  assert.equal(urls.length, 2);
  assert.match(urls[0]!, /pageSize=1000/);
  assert.match(urls[1]!, /pageToken=p2/);
});
