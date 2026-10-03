import OpenAI from 'openai';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type Provider = 'local' | 'groq';

function getProvider(): Provider {
  return process.env.INFERENCE_PROVIDER === 'groq' ? 'groq' : 'local';
}

/**
 * Web search runs inside Open WebUI (its Tavily integration), so it only
 * exists on the local provider — Groq has no equivalent.
 */
export function supportsWebSearch(): boolean {
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

/** Open WebUI's own extension to the OpenAI request body. */
type OpenWebUIParams = ChatCompletionCreateParamsNonStreaming & {
  features?: { web_search?: boolean };
};

export async function chatCompletion(
  model: string,
  messages: ChatMessage[],
  options?: { temperature?: number; webSearch?: boolean },
): Promise<ChatCompletionResult> {
  const client = getProvider() === 'groq' ? getGroqClient() : getLocalClient();
  const params: OpenWebUIParams = {
    model,
    messages,
    ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
    // Open WebUI runs the search and adds the results to the model's context.
    ...(options?.webSearch && supportsWebSearch() ? { features: { web_search: true } } : {}),
  };
  const completion = await client.chat.completions.create(params);
  const reply = completion.choices[0]?.message?.content;

  if (!reply) {
    throw new Error('Inference provider returned an empty response.');
  }

  const usage = completion.usage
    ? {
        promptTokens: completion.usage.prompt_tokens,
        completionTokens: completion.usage.completion_tokens,
        totalTokens: completion.usage.total_tokens,
      }
    : undefined;

  const citations = params.features?.web_search ? extractCitations(completion) : [];

  return { reply, usage, ...(citations.length ? { citations } : {}) };
}
