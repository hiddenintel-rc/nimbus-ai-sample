'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useFlags } from 'launchdarkly-react-client-sdk';
import MessageContent from '@/components/MessageContent';
import UpgradeCta from '@/components/UpgradeCta';
import {
  readServerEvents,
  UNREACHABLE_MESSAGE,
  type GeneratedImage,
  type ServedBy,
} from '@/lib/chat-stream';
import type { Citation } from '@/lib/inference';
import {
  countUserMessages,
  normalizeTierConfig,
  overMessageLimit,
  resolveModel,
  type TierConfig,
} from '@/lib/tier-config';

type Feedback = 'positive' | 'negative';

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
  /** Signed token tying a 👍 / 👎 to the AI Config run that wrote this reply. */
  feedbackToken?: string;
  feedback?: Feedback;
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
      `${message.servedBy.planLabel} plan`,
    ];
    const meter = tokenMeter(message);
    if (meter) parts.push(`${meter} tokens`);
    if (message.webSearch) parts.push('searched the web');
    return parts.join(' · ');
  }
  return null;
}

const TOGGLE_ON =
  'self-center rounded-full border border-blue-600 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 dark:border-blue-500 dark:bg-blue-950 dark:text-blue-300';
const TOGGLE_OFF =
  'self-center rounded-full border border-black/[.1] px-3 py-1 text-xs font-medium text-zinc-950 hover:border-black/[.3] dark:border-white/[.145] dark:text-white';

function toggleClass(on: boolean): string {
  return on ? TOGGLE_ON : TOGGLE_OFF;
}

/** 👍 / 👎 under a reply: the prompt experiment's primary metric. */
function FeedbackButtons({
  value,
  onRate,
}: {
  value?: Feedback;
  onRate: (kind: Feedback) => void;
}) {
  const button = (kind: Feedback, label: string, symbol: string) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={value === kind}
      disabled={value !== undefined}
      onClick={() => onRate(kind)}
      className={
        value === kind
          ? 'rounded-full bg-zinc-200 px-1.5 py-0.5 dark:bg-zinc-800'
          : 'rounded-full px-1.5 py-0.5 opacity-60 hover:opacity-100 disabled:opacity-30 disabled:hover:opacity-30'
      }
    >
      {symbol}
    </button>
  );
  return (
    <div className="mt-1 flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-500">
      {value ? <span>Thanks for the feedback</span> : <span>Helpful?</span>}
      {button('positive', 'Helpful', '👍')}
      {button('negative', 'Not helpful', '👎')}
    </div>
  );
}

export default function ChatPanel({
  initialTierConfig,
  aiDefaultModel,
  canUpgrade = false,
}: {
  initialTierConfig: TierConfig;
  aiDefaultModel?: string;
  /** Free accounts get the upsell; paid ones have nothing to upgrade to here. */
  canUpgrade?: boolean;
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
  /** Set when the server refuses on quota, in case this page's flag value lags. */
  const [serverLimit, setServerLimit] = useState<number | null>(null);

  // These flags only decide whether a toggle is offered (and hide it live
  // when the flag goes off). The server re-checks each flag on every request.
  const flags = useFlags();
  const webSearchAvailable = Boolean(flags['enable-web-search']);
  const imageGenerationAvailable = Boolean(flags['enable-image-generation']);
  const searchRequested = webSearchAvailable && webSearch && !(imageGenerationAvailable && imageGeneration);
  const imageRequested = imageGenerationAvailable && imageGeneration;

  // If chat-tier-config isn't available to client-side SDKs, the flag is
  // missing here and the server-rendered value is used (no live updates).
  const liveTierConfig: unknown = flags['chat-tier-config'];
  const tierConfig = useMemo(
    () => (liveTierConfig === undefined ? initialTierConfig : normalizeTierConfig(liveTierConfig)),
    [liveTierConfig, initialTierConfig],
  );
  // The plan's message allowance. The server decides; this only stops the
  // composer so the user isn't typing into a request that will be refused.
  // `sent + 1` is the message they are about to write, not the one they sent.
  const sent = countUserMessages(messages);
  const messageLimit = serverLimit ?? tierConfig.maxMessagesPerConversation;
  const limitReached =
    serverLimit !== null || overMessageLimit(tierConfig, sent + 1);
  const remaining = messageLimit !== undefined ? Math.max(messageLimit - sent, 0) : undefined;

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
    // A single-GPU backend loads one model at a time, so a different model
    // (or a slow one on the first message) is loaded before it answers.
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
      // Replies, images included, arrive as a stream; a JSON body is always
      // a refusal from before the work started.
      if (contentType.includes('application/json')) {
        const data = await response.json();
        if (response.status === 403 && data?.limitReached) {
          // Nothing was sent, so take the message back out of the thread and
          // hand the text back rather than leaving it sitting there unanswered.
          setMessages(messages);
          setInput(trimmed);
          setServerLimit(typeof data.limit === 'number' ? data.limit : 0);
          return;
        }
        throw new Error(data.error ?? 'Something went wrong.');
      }

      if (!response.ok || !contentType.includes('text/event-stream') || !response.body) {
        throw new Error(UNREACHABLE_MESSAGE);
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
              ...(event.feedbackToken ? { feedbackToken: event.feedbackToken } : {}),
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
        if (event.type === 'image') {
          finished = true;
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: event.reply, imageGeneration: true, images: event.images },
          ]);
          return;
        }
        failed = true;
        setError(event.error);
      });
      if (!finished && !failed) throw new Error(UNREACHABLE_MESSAGE);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setIsLoading(false);
      setReceiving(false);
    }
  }

  // One rating per reply. Shown as given straight away and taken back if the
  // request fails, so a slow round trip doesn't invite a second click.
  async function sendFeedback(index: number, kind: Feedback) {
    const token = messages[index]?.feedbackToken;
    if (!token || messages[index].feedback) return;
    const setFeedback = (feedback: Feedback | undefined) =>
      setMessages((prev) =>
        prev.map((message, i) => (i === index ? { ...message, feedback } : message)),
      );
    setFeedback(kind);
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, kind }),
      });
      if (!response.ok) setFeedback(undefined);
    } catch {
      setFeedback(undefined);
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
            {message.feedbackToken && (
              <FeedbackButtons
                value={message.feedback}
                onRate={(kind) => sendFeedback(index, kind)}
              />
            )}
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

      {limitReached ? (
        <div className="flex flex-col items-start gap-2 rounded-xl border border-black/[.1] bg-zinc-50 px-4 py-3 dark:border-white/[.145] dark:bg-zinc-900">
          <p className="text-sm font-medium text-black dark:text-zinc-50">
            That&apos;s all {messageLimit} messages on the {tierConfig.label} plan.
          </p>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            The limit is per conversation &mdash; reload the page to start a new
            one{canUpgrade ? ', or move up a plan for longer conversations.' : '.'}
          </p>
          {canUpgrade && <UpgradeCta />}
        </div>
      ) : (
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
      )}

      <div className="flex flex-wrap items-center gap-2">
        {status && (
          <p className="basis-full text-xs font-medium text-zinc-950 dark:text-white">{status}</p>
        )}
        {remaining !== undefined && !limitReached && (
          <span className="self-center rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            {remaining} of {messageLimit} messages left
          </span>
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
              {model.label} &mdash; {model.requiredPlan}
            </option>
          ))}
        </select>
        {imageGenerationAvailable && (
          <button
            type="button"
            aria-pressed={imageGeneration}
            onClick={() => setImageGeneration((on) => !on)}
            className={toggleClass(imageGeneration)}
          >
            Generate an image: {imageGeneration ? 'On' : 'Off'}
          </button>
        )}
        {webSearchAvailable && (
          <button
            type="button"
            aria-pressed={webSearch}
            onClick={() => setWebSearch((on) => !on)}
            className={toggleClass(webSearch)}
          >
            Search the web: {webSearch ? 'On' : 'Off'}
          </button>
        )}
      </div>

      {/* Only one Upgrade button is shown: under the controls while messages
          remain, and inside the limit notice once the limit is reached. */}
      {canUpgrade && !limitReached && <UpgradeCta />}
    </div>
  );
}
