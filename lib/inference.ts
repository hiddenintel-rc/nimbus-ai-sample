import OpenAI from 'openai';
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type Provider = 'local' | 'groq';

function getProvider(): Provider {
  return process.env.INFERENCE_PROVIDER === 'groq' ? 'groq' : 'local';
}

/**
 * Web search and image generation both run inside Open WebUI, so they only
 * exist on the local provider — Groq has no equivalent.
 */
export function supportsWebSearch(): boolean {
  return getProvider() === 'local';
}

export function supportsImageGeneration(): boolean {
  return getProvider() === 'local';
}

let localClient: OpenAI | undefined;
let groqClient: OpenAI | undefined;

/**
 * Local AI stack (Open WebUI's OpenAI-compatible API), reached through a
 * Cloudflare Tunnel on a dedicated hostname whose Access application allows
 * Service Auth only. Never points at llama.cpp's own port directly — that's
 * intentionally loopback-only.
 */
function getLocalClient(): OpenAI {
  if (!localClient) {
    const baseURL = process.env.LOCAL_AI_BASE_URL;
    const apiKey = process.env.LOCAL_AI_API_KEY;
    if (!baseURL || !apiKey) {
      throw new Error(
        'LOCAL_AI_BASE_URL / LOCAL_AI_API_KEY are not set. Copy .env.example to .env.local and fill them in.',
      );
    }

    const cfClientId = process.env.CF_ACCESS_CLIENT_ID;
    const cfClientSecret = process.env.CF_ACCESS_CLIENT_SECRET;

    localClient = new OpenAI({
      baseURL,
      apiKey,
      defaultHeaders: {
        ...(cfClientId ? { 'CF-Access-Client-Id': cfClientId } : {}),
        ...(cfClientSecret ? { 'CF-Access-Client-Secret': cfClientSecret } : {}),
      },
    });
  }
  return localClient;
}

/** Manual, opt-in fallback — only used when INFERENCE_PROVIDER=groq is set explicitly. */
function getGroqClient(): OpenAI {
  if (!groqClient) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error('GROQ_API_KEY is not set. Copy .env.example to .env.local and fill it in.');
    }
    groqClient = new OpenAI({ baseURL: 'https://api.groq.com/openai/v1', apiKey });
  }
  return groqClient;
}

/** A numbered web source the reply can cite as `[n]`. */
export type Citation = { n: number; url: string; title?: string };

export type ChatCompletionResult = {
  reply: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  citations?: Citation[];
};

/** One streamed piece of a reply. `completionTokens` counts generated tokens so far, including reasoning that is not shown. */
export type ChatDelta = {
  text: string;
  completionTokens: number;
  promptTokens?: number;
};

type OpenWebUISource = {
  source?: { id?: string };
  document?: unknown[];
  metadata?: { source?: string; title?: string }[];
};

/**
 * Open WebUI returns the search results it gave the model in a top-level
 * `sources` field (not part of the OpenAI schema). It numbers them for the
 * model by unique URL, in the order they appear across `metadata` — the same
 * numbering is rebuilt here so each `[n]` in the reply maps to its URL.
 */
export function extractCitations(raw: unknown): Citation[] {
  const sources = (raw as { sources?: unknown }).sources;
  if (!Array.isArray(sources)) return [];

  const byKey = new Map<string, Citation>();
  for (const entry of sources as OpenWebUISource[]) {
    for (const meta of entry.metadata ?? []) {
      const key = meta?.source ?? entry.source?.id;
      if (!key || byKey.has(key)) continue;
      const n = byKey.size + 1;
      // Keep the numbering intact, but only hand out links that are plain web URLs.
      byKey.set(key, { n, url: /^https?:\/\//i.test(key) ? key : '', title: meta?.title });
    }
  }
  return [...byKey.values()].filter((citation) => citation.url);
}

/** A chat turn gives up after 7 minutes so a stuck model cannot run longer. */
const CHAT_TIMEOUT_MS = 7 * 60 * 1000;

/** Open WebUI's own extension to the OpenAI request body. */
type OpenWebUIParams = ChatCompletionCreateParamsStreaming & {
  features?: { web_search?: boolean };
};

/**
 * Streams the assistant's reply. Each yield is one generated token: visible
 * text, or a reasoning token that only advances the count. The return value
 * carries the full reply, token usage, and any web-search citations.
 * Pass `signal` to stop early when the browser disconnects; the call also
 * stops on its own after {@link CHAT_TIMEOUT_MS}.
 */
export async function* chatCompletion(
  model: string,
  messages: ChatMessage[],
  options?: { temperature?: number; webSearch?: boolean; signal?: AbortSignal },
): AsyncGenerator<ChatDelta, ChatCompletionResult> {
  const client = getProvider() === 'groq' ? getGroqClient() : getLocalClient();
  const signal = AbortSignal.any([
    AbortSignal.timeout(CHAT_TIMEOUT_MS),
    ...(options?.signal ? [options.signal] : []),
  ]);
  const params: OpenWebUIParams = {
    model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
    // Open WebUI runs the search and adds the results to the model's context.
    ...(options?.webSearch && supportsWebSearch() ? { features: { web_search: true } } : {}),
  };
  const stream = await client.chat.completions.create(params, { signal });

  let reply = '';
  let completionTokens = 0;
  let promptTokens: number | undefined;
  let usage: ChatCompletionResult['usage'];
  const rawSources: unknown[] = [];

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta as
      | { content?: string | null; reasoning_content?: string | null; reasoning?: string | null }
      | undefined;
    const text = typeof delta?.content === 'string' ? delta.content : '';
    // Qwen 3.8 spends tokens on reasoning before the visible answer. Those
    // still occupy the context window, so the counter has to move for them.
    const reasoningText =
      typeof delta?.reasoning_content === 'string'
        ? delta.reasoning_content
        : typeof delta?.reasoning === 'string'
          ? delta.reasoning
          : '';
    if (text.length > 0 || reasoningText.length > 0) completionTokens += 1;
    if (chunk.usage) {
      promptTokens = chunk.usage.prompt_tokens;
      usage = {
        promptTokens: chunk.usage.prompt_tokens,
        completionTokens: chunk.usage.completion_tokens,
        totalTokens: chunk.usage.total_tokens,
      };
      if (typeof chunk.usage.completion_tokens === 'number') {
        completionTokens = Math.max(completionTokens, chunk.usage.completion_tokens);
      }
    }
    if (text.length > 0) reply += text;
    if (text.length > 0 || reasoningText.length > 0) {
      yield {
        text,
        completionTokens,
        ...(promptTokens !== undefined ? { promptTokens } : {}),
      };
    }
    // `sources` is Open WebUI's addition. It is not on the OpenAI chunk type,
    // and a streamed search can attach it to whichever event carries it.
    const sources = (chunk as { sources?: unknown }).sources;
    if (Array.isArray(sources)) rawSources.push(...sources);
  }

  if (!reply) {
    throw new Error('Inference provider returned an empty response.');
  }

  const citations = params.features?.web_search ? extractCitations({ sources: rawSources }) : [];
  return { reply, usage, ...(citations.length ? { citations } : {}) };
}

// On Vercel, stay under the 60s Hobby function limit (see app/api/chat/route.ts's
// maxDuration) so a slow upstream fails cleanly instead of the platform killing
// the function mid-request. Self-hosted has no such cap, so ComfyUI gets room
// for a cold start.
const IMAGE_TIMEOUT_MS = process.env.VERCEL ? 55_000 : 240_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function localAuthHeaders(): Record<string, string> {
  const apiKey = process.env.LOCAL_AI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'LOCAL_AI_API_KEY is not set. Copy .env.example to .env.local and fill it in.',
    );
  }
  const cfClientId = process.env.CF_ACCESS_CLIENT_ID;
  const cfClientSecret = process.env.CF_ACCESS_CLIENT_SECRET;
  return {
    Authorization: `Bearer ${apiKey}`,
    ...(cfClientId ? { 'CF-Access-Client-Id': cfClientId } : {}),
    ...(cfClientSecret ? { 'CF-Access-Client-Secret': cfClientSecret } : {}),
  };
}

function localBaseUrl(): string {
  const baseURL = process.env.LOCAL_AI_BASE_URL;
  if (!baseURL) {
    throw new Error(
      'LOCAL_AI_BASE_URL is not set. Copy .env.example to .env.local and fill it in.',
    );
  }
  return baseURL.replace(/\/$/, '');
}

/** Turn Open WebUI's file path into a URL on the same host as the chat API. */
export function resolveOpenWebUIUrl(url: string, baseURL: string): string {
  if (url.startsWith('data:') || /^https?:\/\//i.test(url)) return url;
  return new URL(url, new URL(baseURL).origin).href;
}

async function upstreamError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as { detail?: unknown };
    if (typeof body.detail === 'string' && body.detail.trim()) return body.detail;
    if (body.detail && typeof body.detail === 'object' && 'message' in body.detail) {
      const message = (body.detail as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return message;
    }
  } catch {
    // Plain text or HTML from the proxy.
  }
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return trimmed.slice(0, 300) || `Image request failed (${response.status}).`;
}

/**
 * Sends the user's prompt straight to Open WebUI's image API. The chat
 * completion `features.image_generation` flag only paints inside a saved
 * Open WebUI chat (it needs a chat id and a live event stream), so an
 * external caller has to use this endpoint. Open WebUI then calls ComfyUI
 * and returns a file URL, which is fetched here and handed back as a data
 * URL the browser can show without Open WebUI credentials.
 */
export async function generateImage(prompt: string): Promise<{ dataUrl: string }> {
  const baseURL = localBaseUrl();
  const headers = localAuthHeaders();
  const created = await fetch(`${baseURL}/v1/images/generations`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
    signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
  });

  if (!created.ok) {
    throw new Error(await upstreamError(created));
  }

  const payload = (await created.json()) as unknown;
  const first = Array.isArray(payload) ? payload[0] : null;
  const url = first && typeof first === 'object' ? (first as { url?: unknown }).url : undefined;
  if (typeof url !== 'string' || !url) {
    throw new Error('Open WebUI did not return an image.');
  }

  if (url.startsWith('data:')) {
    return { dataUrl: url };
  }

  const file = await fetch(resolveOpenWebUIUrl(url, baseURL), {
    headers,
    signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
  });
  if (!file.ok) {
    throw new Error(await upstreamError(file));
  }

  const mediaType = file.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png';
  if (!mediaType.startsWith('image/')) {
    throw new Error('Open WebUI returned a file that is not an image.');
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error('The generated image was empty or larger than expected.');
  }

  return { dataUrl: `data:${mediaType};base64,${bytes.toString('base64')}` };
}
