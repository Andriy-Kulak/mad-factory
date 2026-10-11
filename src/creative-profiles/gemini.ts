import { requireEnv } from "../lib/env.ts";
import type { ChatMessage, Completion, ContentPart } from "./gateway.ts";

/** Minimal Google Gemini API client: native generateContent REST format, no retries. */

const BASE = "https://generativelanguage.googleapis.com/v1beta";

interface GeminiPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
}

function inlineData(dataUrl: string): GeminiPart {
  const match = /^data:([^;,]+);base64,([\s\S]*)$/.exec(dataUrl);
  if (!match) throw new Error("unsupported media part (expected a base64 data: URL)");
  return { inline_data: { mime_type: match[1]!, data: match[2]! } };
}

function toGeminiPart(part: ContentPart): GeminiPart {
  if (part.type === "text") return { text: String(part.text ?? "") };
  if (part.type === "file") return inlineData(String((part.file as { file_data?: unknown }).file_data));
  if (part.type === "image_url") return inlineData(String((part.image_url as { url?: unknown }).url));
  throw new Error(`unsupported content part type "${part.type}"`);
}

function toContents(messages: ChatMessage[]): { system: string[]; contents: { role: "user" | "model"; parts: GeminiPart[] }[] } {
  const system: string[] = [];
  const contents: { role: "user" | "model"; parts: GeminiPart[] }[] = [];
  for (const message of messages) {
    const parts = typeof message.content === "string" ? [{ text: message.content }] : message.content.map(toGeminiPart);
    if (message.role === "system") {
      for (const part of parts) if (part.text) system.push(part.text);
      continue;
    }
    contents.push({ role: message.role === "assistant" ? "model" : "user", parts });
  }
  return { system, contents };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    totalTokenCount?: number;
  };
}

export async function completeGemini(messages: ChatMessage[], options: { model: string }, fetchFn: typeof fetch = fetch): Promise<Completion> {
  const { system, contents } = toContents(messages);
  const response = await fetchFn(`${BASE}/models/${options.model}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": requireEnv("GEMINI_API_KEY"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents,
      ...(system.length ? { systemInstruction: { parts: system.map((text) => ({ text })) } } : {}),
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Gemini API ${response.status}: ${text.slice(0, 500)}`);
  }
  let body: GeminiResponse;
  try {
    body = JSON.parse(text) as GeminiResponse;
  } catch {
    throw new Error(`Gemini API returned non-JSON: ${text.slice(0, 200)}`);
  }
  const candidate = body.candidates?.[0];
  const content = (candidate?.content?.parts ?? []).map((part) => part.text ?? "").join("");
  if (!content) {
    throw new Error(`Gemini API returned no text (finishReason: ${candidate?.finishReason ?? "none"}, blockReason: ${body.promptFeedback?.blockReason ?? "none"})`);
  }
  const meta = body.usageMetadata;
  const usage = meta
    ? {
        prompt_tokens: meta.promptTokenCount ?? 0,
        completion_tokens: (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0),
        total_tokens: meta.totalTokenCount ?? 0,
      }
    : null;
  return { content, usage };
}

/**
 * The highest-versioned stable `gemini-*-flash` model that supports
 * generateContent: no -lite, -preview, -exp or dated variants.
 */
export async function latestFlashModel(fetchFn: typeof fetch = fetch): Promise<string> {
  const key = requireEnv("GEMINI_API_KEY");
  let best: string | null = null;
  let bestVersion = "";
  let pageToken: string | undefined;
  do {
    const url = `${BASE}/models?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const response = await fetchFn(url, { headers: { "x-goog-api-key": key } });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Gemini API ${response.status}: ${text.slice(0, 500)}`);
    }
    const body = JSON.parse(text) as {
      models?: { name?: string; supportedGenerationMethods?: string[] }[];
      nextPageToken?: string;
    };
    for (const model of body.models ?? []) {
      const match = /^models\/gemini-(\d+(?:\.\d+)?)-flash$/.exec(model.name ?? "");
      if (!match) continue;
      if (!(model.supportedGenerationMethods ?? []).includes("generateContent")) continue;
      if (!best || Number(match[1]) > Number(bestVersion)) {
        best = model.name!.slice("models/".length);
        bestVersion = match[1]!;
      }
    }
    pageToken = body.nextPageToken;
  } while (pageToken);
  if (!best) throw new Error("no stable gemini-*-flash model with generateContent found");
  return best;
}
