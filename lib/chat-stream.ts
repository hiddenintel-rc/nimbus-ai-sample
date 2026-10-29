import type { ChatCompletionResult, Citation } from '@/lib/inference';

/**
 * The server-sent events /api/chat streams to the browser, and the browser's
 * parser for them. Shared so both sides agree on each event's shape.
 */

/** The model and plan that answered a reply, shown in the caption under the chat. */
export type ServedBy = { model: string; modelLabel: string; planLabel: string };
export type GeneratedImage = { src: string; alt: string };
export type TokenUsage = NonNullable<ChatCompletionResult['usage']>;

export type StreamEvent =
  | { type: 'meta'; servedBy: ServedBy; webSearch: boolean; maxTokens?: number }
  | { type: 'delta'; text: string; completionTokens: number; promptTokens?: number }
  | { type: 'done'; citations: Citation[]; usage?: TokenUsage; feedbackToken?: string }
  | { type: 'image'; reply: string; images: GeneratedImage[] }
  | { type: 'error'; error: string };

export const UNREACHABLE_MESSAGE = 'The chat backend is unreachable right now. Please try again shortly.';

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** One event from its JSON `data:` payload, or null if it isn't a well-formed event. */
export function parseStreamEvent(raw: string): StreamEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const event = value as {
    type?: unknown;
    text?: unknown;
    error?: unknown;
    webSearch?: unknown;
    maxTokens?: unknown;
    completionTokens?: unknown;
    promptTokens?: unknown;
    usage?: { promptTokens?: unknown; completionTokens?: unknown; totalTokens?: unknown };
    servedBy?: { model?: unknown; modelLabel?: unknown; planLabel?: unknown };
    citations?: unknown;
    reply?: unknown;
    images?: unknown;
    feedbackToken?: unknown;
  };
  if (
    event.type === 'meta' &&
    event.servedBy &&
    typeof event.servedBy.model === 'string' &&
    typeof event.servedBy.modelLabel === 'string' &&
    typeof event.servedBy.planLabel === 'string'
  ) {
    const maxTokens = finiteNumber(event.maxTokens);
    return {
      type: 'meta',
      servedBy: {
        model: event.servedBy.model,
        modelLabel: event.servedBy.modelLabel,
        planLabel: event.servedBy.planLabel,
      },
      webSearch: event.webSearch === true,
      ...(maxTokens !== undefined ? { maxTokens } : {}),
    };
  }
  const completionTokens = finiteNumber(event.completionTokens);
  if (event.type === 'delta' && completionTokens !== undefined) {
    const promptTokens = finiteNumber(event.promptTokens);
    return {
      type: 'delta',
      text: typeof event.text === 'string' ? event.text : '',
      completionTokens,
      ...(promptTokens !== undefined ? { promptTokens } : {}),
    };
  }
  if (event.type === 'done') {
    const citations = Array.isArray(event.citations)
      ? event.citations.filter(
          (entry): entry is Citation =>
            !!entry &&
            typeof entry === 'object' &&
            typeof (entry as Citation).n === 'number' &&
            typeof (entry as Citation).url === 'string',
        )
      : [];
    const promptTokens = finiteNumber(event.usage?.promptTokens);
    const usageCompletionTokens = finiteNumber(event.usage?.completionTokens);
    const totalTokens = finiteNumber(event.usage?.totalTokens);
    const usage =
      promptTokens !== undefined && usageCompletionTokens !== undefined && totalTokens !== undefined
        ? { promptTokens, completionTokens: usageCompletionTokens, totalTokens }
        : undefined;
    return {
      type: 'done',
      citations,
      ...(usage ? { usage } : {}),
      ...(typeof event.feedbackToken === 'string' ? { feedbackToken: event.feedbackToken } : {}),
    };
  }
  if (event.type === 'image' && Array.isArray(event.images)) {
    const images = event.images.filter(
      (entry): entry is GeneratedImage =>
        !!entry &&
        typeof entry === 'object' &&
        typeof (entry as GeneratedImage).src === 'string' &&
        typeof (entry as GeneratedImage).alt === 'string',
    );
    if (images.length === 0) return null;
    return { type: 'image', reply: typeof event.reply === 'string' ? event.reply : '', images };
  }
  if (event.type === 'error' && typeof event.error === 'string') {
    return { type: 'error', error: event.error };
  }
  return null;
}

/** Reads SSE `data:` events. Lines that start with `:` are comments and are skipped. */
export async function readServerEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: StreamEvent) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let splitAt = buffer.indexOf('\n\n');
    while (splitAt !== -1) {
      const raw = buffer.slice(0, splitAt);
      buffer = buffer.slice(splitAt + 2);
      const data = raw
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (data) {
        const event = parseStreamEvent(data);
        if (event) onEvent(event);
      }
      splitAt = buffer.indexOf('\n\n');
    }
  }
}
