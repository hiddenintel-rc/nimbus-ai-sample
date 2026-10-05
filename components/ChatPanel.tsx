'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useFlags } from 'launchdarkly-react-client-sdk';
import MessageContent, { type Citation } from '@/components/MessageContent';
import { normalizeTierConfig, resolveModel, type TierConfig } from '@/lib/tier-config';

type ServedBy = { model: string; modelLabel: string; label: string };
type GeneratedImage = { src: string; alt: string };
type Message = {
  role: 'user' | 'assistant';
  content: string;
  servedBy?: ServedBy;
  webSearch?: boolean;
  imageGeneration?: boolean;
  images?: GeneratedImage[];
  citations?: Citation[];
};

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setIsLoading(false);
    }
  }

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
            {(message.servedBy || message.imageGeneration) && (
              <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-600">
                {message.imageGeneration ? (
                  <>generated locally</>
                ) : (
                  message.servedBy && (
                    <>
                      served by {message.servedBy.modelLabel ?? message.servedBy.model} &middot;{' '}
                      {message.servedBy.label} config
                      {message.webSearch && <> &middot; searched the web</>}
                    </>
                  )
                )}
              </p>
            )}
          </div>
        ))}
        {isLoading && (
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

      <div className="flex flex-wrap gap-2">
        {/* Locked models are listed but disabled, so each plan can see what
            the next one adds. The server rejects them regardless. */}
        <select
          aria-label="Model"
          value={selectedModel.id}
          onChange={(event) => setModelChoice(event.target.value)}
          disabled={imageRequested}
          title={imageRequested ? 'Image generation does not use the chat model' : undefined}
          className="self-start rounded-full border border-black/[.1] bg-white px-3 py-1 text-xs font-medium text-zinc-600 hover:border-black/[.3] disabled:opacity-50 dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-400"
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
                ? 'self-start rounded-full border border-blue-600 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 dark:border-blue-500 dark:bg-blue-950 dark:text-blue-300'
                : 'self-start rounded-full border border-black/[.1] px-3 py-1 text-xs font-medium text-zinc-600 hover:border-black/[.3] dark:border-white/[.145] dark:text-zinc-400'
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
                ? 'self-start rounded-full border border-blue-600 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 dark:border-blue-500 dark:bg-blue-950 dark:text-blue-300'
                : 'self-start rounded-full border border-black/[.1] px-3 py-1 text-xs font-medium text-zinc-600 hover:border-black/[.3] dark:border-white/[.145] dark:text-zinc-400'
            }
          >
            Search the web: {webSearch ? 'On' : 'Off'}
          </button>
        )}
      </div>
    </div>
  );
}
