import { requireEnv } from "../lib/env.ts";

/** Minimal Vercel AI Gateway client: OpenAI chat format, no retries. */

const ENDPOINT = "https://ai-gateway.vercel.sh/v1/chat/completions";

export interface ContentPart {
  type: string;
  [key: string]: unknown;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

export interface Completion {
  content: string;
  usage: unknown;
}

export async function complete(messages: ChatMessage[], options: { model: string }, fetchFn: typeof fetch = fetch): Promise<Completion> {
  const response = await fetchFn(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("AI_GATEWAY_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model,
      messages,
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`AI gateway ${response.status}: ${text.slice(0, 500)}`);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`AI gateway returned non-JSON: ${text.slice(0, 200)}`);
  }
  const choices = (body as { choices?: { message?: { content?: unknown } }[] }).choices;
  const content = choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("AI gateway returned no message content");
  return { content, usage: (body as { usage?: unknown }).usage ?? null };
}
