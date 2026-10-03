'use client';

import { useState, type FormEvent } from 'react';
import { useFlags } from 'launchdarkly-react-client-sdk';
import MessageContent, { type Citation } from '@/components/MessageContent';

type ServedBy = { model: string; label: string };
type Message = {
  role: 'user' | 'assistant';
  content: string;
  servedBy?: ServedBy;
  webSearch?: boolean;
  citations?: Citation[];
};

export default function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [webSearch, setWebSearch] = useState(false);
  const [searching, setSearching] = useState(false);

  // `enable-web-search` only decides whether the toggle is offered (and hides it
  // live when the flag goes off); the server re-checks the flag on every request.
  const flags = useFlags();
  const webSearchAvailable = Boolean(flags['enable-web-search']);
  const searchRequested = webSearchAvailable && webSearch;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const nextMessages = [...messages, { role: 'user' as const, content: trimmed }];
    setMessages(nextMessages);
    setInput('');
    setIsLoading(true);
    setSearching(searchRequested);
    setError(null);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages, webSearch: searchRequested }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? 'Something went wrong.');
      }
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.reply,
          servedBy: data.servedBy,
          webSearch: data.webSearch,
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
                // Searched replies always get a (possibly empty) citation list, so
                // markers without a source are dropped instead of left dangling.
                <MessageContent
                  content={message.content}
                  citations={message.webSearch ? (message.citations ?? []) : undefined}
                />
              ) : (
                message.content
              )}
            </div>
            {message.servedBy && (
              <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-600">
                served by {message.servedBy.model} &middot; {message.servedBy.label} config
                {message.webSearch && <> &middot; searched the web</>}
              </p>
            )}
          </div>
        ))}
        {isLoading && (
          <div className="self-start rounded-xl bg-zinc-100 px-3 py-2 text-sm text-zinc-500 dark:bg-zinc-900 dark:text-zinc-500">
            {searching ? 'Searching the web…' : 'Thinking…'}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask something…"
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
  );
}
