'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useFlags } from 'launchdarkly-react-client-sdk';
import MessageContent, { type Citation } from '@/components/MessageContent';
import { normalizeTierConfig, resolveModel, type TierConfig } from '@/lib/tier-config';

type ServedBy = { model: string; modelLabel: string; label: string };
type GeneratedImage = { src: string; alt: string };
type TokenUsage = { promptTokens: number; completionTokens: number; totalTokens: number };
type StreamEvent =
  | { type: 'meta'; servedBy: ServedBy; webSearch: boolean; maxTokens?: number }
  | { type: 'delta'; text: string; completionTokens: number; promptTokens?: number }
  | { type: 'done'; citations: Citation[]; usage?: TokenUsage }
  | { type: 'error'; error: string };

function countTokens(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

const UNREACHABLE = 'The chat backend is unreachable right now. Please try again shortly.';

function parseStreamEvent(raw: string): StreamEvent | null {
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
    servedBy?: { model?: unknown; modelLabel?: unknown; label?: unknown };
    citations?: unknown;
  };
  if (
    event.type === 'meta' &&
    event.servedBy &&
    typeof event.servedBy.model === 'string' &&
    typeof event.servedBy.modelLabel === 'string' &&
    typeof event.servedBy.label === 'string'
  ) {
    return {
      type: 'meta',
      servedBy: {
        model: event.servedBy.model,
        modelLabel: event.servedBy.modelLabel,
        label: event.servedBy.label,
      },
      webSearch: event.webSearch === true,
      ...(countTokens(event.maxTokens) !== undefined ? { maxTokens: countTokens(event.maxTokens) } : {}),
    };
  }
  if (event.type === 'delta' && countTokens(event.completionTokens) !== undefined) {
    return {
      type: 'delta',
      text: typeof event.text === 'string' ? event.text : '',
      completionTokens: countTokens(event.completionTokens)!,
      ...(countTokens(event.promptTokens) !== undefined
        ? { promptTokens: countTokens(event.promptTokens) }
        : {}),
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
    const promptTokens = countTokens(event.usage?.promptTokens);
    const completionTokens = countTokens(event.usage?.completionTokens);
    const totalTokens = countTokens(event.usage?.totalTokens);
    const usage =
      promptTokens !== undefined && completionTokens !== undefined && totalTokens !== undefined
        ? { promptTokens, completionTokens, totalTokens }
        : undefined;
    return { type: 'done', citations, ...(usage ? { usage } : {}) };
  }
  if (event.type === 'error' && typeof event.error === 'string') {
    return { type: 'error', error: event.error };
  }
  return null;
}

/** Reads SSE `data:` events. Lines that start with `:` are comments and are skipped. */
async function readServerEvents(
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
type Message = {
  role: 'user' | 'assistant';
  content: string;
  servedBy?: ServedBy;
  webSearch?: boolean;
  imageGeneration?: boolean;
  images?: GeneratedImage[];
  citations?: Citation[];
  /** Context window for the model that wrote this reply. */
  maxTokens?: number;
  /** Prompt tokens, once the provider reports them. */
  promptTokens?: number;
  /** Generated tokens so far, including reasoning. */
  completionTokens?: number;
};

function tokenMeter(message: Message): string | null {
  if (typeof message.maxTokens !== 'number' || typeof message.completionTokens !== 'number') return null;
  return `${message.completionTokens.toLocaleString('en-US')} / ${message.maxTokens.toLocaleString('en-US')}`;
}

/** Latest reply caption, shown beside the model and tool controls. */
function replyStatus(messages: Message[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'assistant') continue;
    if (message.imageGeneration) return 'generated locally';
    if (!message.servedBy) continue;
    const parts = [
      `served by ${message.servedBy.modelLabel || message.servedBy.model}`,
      `${message.servedBy.label} config`,
    ];
    const meter = tokenMeter(message);
    if (meter) parts.push(`${meter} tokens`);
    if (message.webSearch) parts.push('searched the web');
    return parts.join(' · ');
  }
  return null;
}

export default function ChatPanel({
  initialTierConfig,
  aiDefaultModel,
}: {
  initialTierConfig: TierConfig;
  aiDefaultModel?: string;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [modelChoice, setModelChoice] = useState<string | null>(null);
  const [lastServedModel, setLastServedModel] = useState<string | null>(null);
  const [switchingModel, setSwitchingModel] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [webSearch, setWebSearch] = useState(false);
  const [imageGeneration, setImageGeneration] = useState(false);
  const [searching, setSearching] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [receiving, setReceiving] = useState(false);

  // These flags only decide whether a toggle is offered (and hide it live
  // when the flag goes off). The server re-checks each flag on every request.
  const flags = useFlags();
  const webSearchAvailable = Boolean(flags['enable-web-search']);
  const imageGenerationAvailable = Boolean(flags['enable-image-generation']);
  const searchRequested = webSearchAvailable && webSearch && !(imageGenerationAvailable && imageGeneration);
  const imageRequested = imageGenerationAvailable && imageGeneration;

  // Until chat-tier-config is available to client-side SDKs, the flag is
  // missing here and the server-rendered value is used (no live updates).
  const liveTierConfig: unknown = flags['chat-tier-config'];
  const tierConfig = useMemo(
    () => (liveTierConfig === undefined ? initialTierConfig : normalizeTierConfig(liveTierConfig)),
    [liveTierConfig, initialTierConfig],
  );
  // A pick the tier no longer allows (flag edit, plan change) is dropped, so
  // the menu falls back to the default instead of showing a locked model.
  const allowedChoice =
    modelChoice && tierConfig.models.some((model) => model.id === modelChoice) ? modelChoice : null;
  const selectedModel = resolveModel(tierConfig, allowedChoice ?? lastServedModel, aiDefaultModel);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const nextMessages = [...messages, { role: 'user' as const, content: trimmed }];
    setMessages(nextMessages);
    setInput('');
    setIsLoading(true);
    setReceiving(false);
    setSearching(searchRequested);
    setGeneratingImage(imageRequested);
    // The home lab keeps one model loaded at a time, so a different model
    // (or a slow one on the first message) means a reload before it answers.
    const needsLoad =
      !imageRequested &&
      (lastServedModel ? selectedModel.id !== lastServedModel : Boolean(selectedModel.slow));
    setSwitchingModel(needsLoad ? selectedModel.label : null);
    setError(null);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages,
          webSearch: searchRequested,
          imageGeneration: imageRequested,
          // Only an explicit pick is sent; otherwise the server applies the
          // AI Config's model (if this tier allows it) or the tier default.
          model: allowedChoice,
        }),
      });
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error ?? 'Something went wrong.');
        }
        if (data.servedBy?.model) setLastServedModel(data.servedBy.model);
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: data.reply,
            servedBy: data.servedBy,
            webSearch: data.webSearch,
            imageGeneration: data.imageGeneration,
            images: data.images,
            citations: data.citations,
          },
        ]);
        return;
      }

      if (!response.ok || !contentType.includes('text/event-stream') || !response.body) {
        throw new Error(UNREACHABLE);
      }

      let finished = false;
      let failed = false;
      await readServerEvents(response.body, (event) => {
        if (event.type === 'meta') {
          setReceiving(true);
          setSwitchingModel(null);
          setSearching(false);
          setLastServedModel(event.servedBy.model);
          setMessages((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: '',
              servedBy: event.servedBy,
              webSearch: event.webSearch,
              maxTokens: event.maxTokens,
              completionTokens: 0,
            },
          ]);
          return;
        }
        if (event.type === 'delta') {
          setMessages((prev) => {
            const next = prev.slice();
            const last = next[next.length - 1];
            if (!last || last.role !== 'assistant') return prev;
            next[next.length - 1] = {
              ...last,
              content: event.text ? last.content + event.text : last.content,
              completionTokens: event.completionTokens,
              ...(event.promptTokens !== undefined ? { promptTokens: event.promptTokens } : {}),
            };
            return next;
          });
          return;
        }
        if (event.type === 'done') {
          finished = true;
          setMessages((prev) => {
            const next = prev.slice();
            const last = next[next.length - 1];
            if (!last || last.role !== 'assistant') return prev;
            next[next.length - 1] = {
              ...last,
              citations: event.citations,
              ...(event.usage
                ? {
                    promptTokens: event.usage.promptTokens,
                    completionTokens: event.usage.completionTokens,
                  }
                : {}),
            };
            return next;
          });
          return;
        }
        failed = true;
        setError(event.error);
      });
      if (!finished && !failed) throw new Error(UNREACHABLE);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setIsLoading(false);
      setReceiving(false);
    }
  }

  const status = replyStatus(messages);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex max-h-[32rem] flex-col gap-3 overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-sm text-zinc-500 dark:text-zinc-500">
            Ask the assistant something to try it out.
          </p>
        )}
        {messages.map((message, index) => (
          <div
            key={index}
            className={message.role === 'user' ? 'self-end' : 'self-start'}
          >
            <div
              className={
                message.role === 'user'
                  ? 'whitespace-pre-wrap rounded-xl bg-black px-3 py-2 text-sm text-white dark:bg-zinc-50 dark:text-black'
                  : 'rounded-xl bg-zinc-100 px-3 py-2 text-sm text-black dark:bg-zinc-900 dark:text-zinc-50'
              }
            >
              {message.role === 'assistant' ? (
                <>
                  {/* Searched replies always get a citation list, so markers
                      without a source are dropped instead of left dangling. */}
                  <MessageContent
                    content={message.content}
                    citations={message.webSearch ? (message.citations ?? []) : undefined}
                  />
                  {message.images?.map((image, imageIndex) => (
                    // The src is a data URL fetched server-side; next/image cannot optimize it.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={imageIndex}
                      src={image.src}
                      alt={image.alt}
                      className="mt-2 max-h-80 w-full rounded-lg object-contain"
                    />
                  ))}
                </>
              ) : (
                message.content
              )}
            </div>
          </div>
        ))}
        {isLoading && !receiving && (
          <div className="self-start rounded-xl bg-zinc-100 px-3 py-2 text-sm text-zinc-500 dark:bg-zinc-900 dark:text-zinc-500">
            {generatingImage
              ? 'Generating an image…'
              : switchingModel
                ? `Loading ${switchingModel}… the first reply can take a while.`
                : searching
                  ? 'Searching the web…'
                  : 'Thinking…'}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={imageRequested ? 'Describe an image…' : 'Ask something…'}
          className="flex-1 rounded-lg border border-black/[.1] bg-white px-3 py-2 text-sm text-black outline-none focus:border-black/[.3] dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-50"
        />
        <button
          type="submit"
          disabled={isLoading}
          className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-black"
        >
          Send
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        {status && (
          <p className="basis-full text-xs font-medium text-zinc-950 dark:text-white">{status}</p>
        )}
        {/* Locked models are listed but disabled, so each plan can see what
            the next one adds. The server rejects them regardless. */}
        <select
          aria-label="Model"
          value={selectedModel.id}
          onChange={(event) => setModelChoice(event.target.value)}
          disabled={imageRequested}
          title={imageRequested ? 'Image generation does not use the chat model' : undefined}
          className="self-center rounded-full border border-black/[.1] bg-white px-3 py-1 text-xs font-medium text-zinc-950 hover:border-black/[.3] disabled:opacity-50 dark:border-white/[.145] dark:bg-zinc-950 dark:text-white"
        >
          {tierConfig.models.map((model) => (
            <option key={model.id} value={model.id}>
              Model: {model.label}
              {model.slow ? ' (slower to load)' : ''}
            </option>
          ))}
          {tierConfig.lockedModels.map((model) => (
            <option key={model.id} value={model.id} disabled>
              {model.label} &mdash; {model.requiredTier}
            </option>
          ))}
        </select>
        {imageGenerationAvailable && (
          <button
            type="button"
            aria-pressed={imageGeneration}
            onClick={() => setImageGeneration((on) => !on)}
            className={
              imageGeneration
                ? 'self-center rounded-full border border-blue-600 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 dark:border-blue-500 dark:bg-blue-950 dark:text-blue-300'
                : 'self-center rounded-full border border-black/[.1] px-3 py-1 text-xs font-medium text-zinc-950 hover:border-black/[.3] dark:border-white/[.145] dark:text-white'
            }
          >
            Generate an image: {imageGeneration ? 'On' : 'Off'}
          </button>
        )}
        {webSearchAvailable && (
          <button
            type="button"
            aria-pressed={webSearch}
            onClick={() => setWebSearch((on) => !on)}
            className={
              webSearch
                ? 'self-center rounded-full border border-blue-600 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 dark:border-blue-500 dark:bg-blue-950 dark:text-blue-300'
                : 'self-center rounded-full border border-black/[.1] px-3 py-1 text-xs font-medium text-zinc-950 hover:border-black/[.3] dark:border-white/[.145] dark:text-white'
            }
          >
            Search the web: {webSearch ? 'On' : 'Off'}
          </button>
        )}
      </div>
    </div>
  );
}
