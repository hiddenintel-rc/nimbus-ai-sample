import { NextResponse } from 'next/server';
import { chatCompletion, DEFAULT_CHAT_MODEL, type ChatMessage } from '@/lib/inference';
import { getLDClient, anonymousContext } from '@/lib/ld-server';

type IncomingMessage = { role: 'user' | 'assistant'; content: string };

function isValidHistory(value: unknown): value is IncomingMessage[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        (entry.role === 'user' || entry.role === 'assistant') &&
        typeof entry.content === 'string' &&
        entry.content.trim().length > 0,
    )
  );
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const history = isValidHistory(body?.messages) ? body.messages : null;

  if (!history) {
    return NextResponse.json({ error: 'messages is required' }, { status: 400 });
  }

  const client = await getLDClient();
  const memoryEnabled = await client.variation(
    'enable-conversation-memory',
    anonymousContext,
    false,
  );

  // With memory off (legacy behavior), only the latest message is sent —
  // every turn is treated as a fresh conversation, same as before this flag existed.
  const relevantHistory = memoryEnabled ? history : history.slice(-1);

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: 'You are the Nimbus assistant, a helpful AI chat demo. Keep replies concise.',
    },
    ...relevantHistory,
  ];

  try {
    const reply = await chatCompletion(DEFAULT_CHAT_MODEL, messages);
    return NextResponse.json({ reply });
  } catch (error) {
    console.error('[api/chat]', error);
    return NextResponse.json(
      { error: 'The chat backend is unreachable right now. Please try again shortly.' },
      { status: 502 },
    );
  }
}
