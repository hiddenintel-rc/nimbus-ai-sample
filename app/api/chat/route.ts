import { NextResponse } from 'next/server';
import { chatCompletion, type ChatMessage } from '@/lib/inference';
import { getLDClient, buildUserContext } from '@/lib/ld-server';
import { auth } from '@/lib/auth';
import { DEFAULT_TIER_CONFIG, type TierConfig } from '@/lib/tier-config';

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
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: 'You must be logged in to use the chat demo.' },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const history = isValidHistory(body?.messages) ? body.messages : null;

  if (!history) {
    return NextResponse.json({ error: 'messages is required' }, { status: 400 });
  }

  const client = await getLDClient();
  const context = buildUserContext(session.user);

  // Both flag keys below must exist in your own LaunchDarkly environment —
  // see "Re-create the LaunchDarkly flags" in the README for exact keys,
  // variations, and targeting. The default values passed here only cover
  // LaunchDarkly being briefly unreachable, not a missing/never-created flag.
  const memoryEnabled = await client.variation('enable-conversation-memory', context, false);
  const tierConfig = (await client.variation(
    'chat-tier-config',
    context,
    DEFAULT_TIER_CONFIG,
  )) as TierConfig;

  // With memory off (legacy behavior), only the latest message is sent —
  // every turn is treated as a fresh conversation, same as before that flag
  // existed. With memory on, the tier config's context window caps how much
  // history this account's plan is allowed to carry.
  const relevantHistory = memoryEnabled
    ? history.slice(-tierConfig.maxContextMessages)
    : history.slice(-1);

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: 'You are the Nimbus assistant, a helpful AI chat demo. Keep replies concise.',
    },
    ...relevantHistory,
  ];

  try {
    const reply = await chatCompletion(tierConfig.model, messages);
    return NextResponse.json({ reply, servedBy: tierConfig });
  } catch (error) {
    console.error('[api/chat]', error);
    return NextResponse.json(
      { error: 'The chat backend is unreachable right now. Please try again shortly.' },
      { status: 502 },
    );
  }
}
