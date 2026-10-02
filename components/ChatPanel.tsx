'use client';

import { useState, type FormEvent } from 'react';

type Message = { role: 'user' | 'assistant'; content: string };

export default function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? 'Something went wrong.');
      }
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex max-h-80 flex-col gap-3 overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-sm text-zinc-500 dark:text-zinc-500">
            Ask the assistant something to try it out.
          </p>
        )}
        {messages.map((message, index) => (
          <div
            key={index}
            className={
              message.role === 'user'
                ? 'self-end rounded-xl bg-black px-3 py-2 text-sm text-white dark:bg-zinc-50 dark:text-black'
                : 'self-start rounded-xl bg-zinc-100 px-3 py-2 text-sm text-black dark:bg-zinc-900 dark:text-zinc-50'
            }
          >
            {message.content}
          </div>
        ))}
        {isLoading && (
          <div className="self-start rounded-xl bg-zinc-100 px-3 py-2 text-sm text-zinc-500 dark:bg-zinc-900 dark:text-zinc-500">
            Thinking…
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
    </div>
  );
}
