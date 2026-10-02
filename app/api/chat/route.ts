import { NextResponse } from 'next/server';
import { chatCompletion, DEFAULT_CHAT_MODEL, type ChatMessage } from '@/lib/inference';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const message = typeof body?.message === 'string' ? body.message.trim() : '';

  if (!message) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: 'You are the Nimbus assistant, a helpful AI chat demo. Keep replies concise.',
    },
    { role: 'user', content: message },
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
