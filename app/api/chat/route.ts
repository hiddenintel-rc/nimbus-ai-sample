import { NextResponse } from 'next/server';
import {
  chatCompletion,
  supportsWebSearch,
  type ChatCompletionResult,
  type ChatMessage,
} from '@/lib/inference';
import { getLDClient, getAiClient, buildUserContext } from '@/lib/ld-server';
import { auth } from '@/lib/auth';
import { DEFAULT_TIER_CONFIG, type TierConfig } from '@/lib/tier-config';
import { AI_CONFIG_KEY, DEFAULT_AI_CONFIG } from '@/lib/ai-config';
import type { LDAIMetrics } from '@launchdarkly/server-sdk-ai';

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

function toLDMetrics(result: ChatCompletionResult): LDAIMetrics {
  return {
    success: true,
    tokens: result.usage
      ? {
          total: result.usage.totalTokens,
          input: result.usage.promptTokens,
          output: result.usage.completionTokens,
        }
      : undefined,
  };
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

  // All three flag keys below must exist in your own LaunchDarkly environment —
  // see "Re-create the LaunchDarkly flags" in the README for exact keys,
  // variations, and targeting. The default values passed here only cover
  // LaunchDarkly being briefly unreachable, not a missing/never-created flag.
  const memoryEnabled = await client.variation('enable-conversation-memory', context, false);
  const tierConfig = (await client.variation(
    'chat-tier-config',
    context,
    DEFAULT_TIER_CONFIG,
  )) as TierConfig;
  const webSearchEnabled = await client.variation('enable-web-search', context, false);

  // The browser's toggle is only a request: search runs when the flag allows
  // it for this account and the backend supports it, never just because the
  // client asked.
  const webSearch = webSearchEnabled && body?.webSearch === true && supportsWebSearch();

  // AI Config (AgentControl) — a separate concern from chat-tier-config above.
  // This one controls the assistant's prompt/temperature for every account;
  // it never decides which model backend answers — that stays tier-driven.
  // Must exist in your own LD environment — see "Create the AI Config" in
  // the README.
  const aiClient = await getAiClient();
  const aiConfig = await aiClient.completionConfig(AI_CONFIG_KEY, context, DEFAULT_AI_CONFIG);

  // With memory off (legacy behavior), only the latest message is sent —
  // every turn is treated as a fresh conversation, same as before that flag
  // existed. With memory on, the tier config's context window caps how much
  // history this account's plan is allowed to carry.
  const relevantHistory = memoryEnabled
    ? history.slice(-tierConfig.maxContextMessages)
    : history.slice(-1);

  const systemMessages: ChatMessage[] =
    aiConfig.enabled && aiConfig.messages?.length
      ? aiConfig.messages
      : [
          {
            role: 'system',
            content: 'You are the Nimbus assistant, a helpful AI chat demo. Keep replies concise.',
          },
        ];

  const messages: ChatMessage[] = [...systemMessages, ...relevantHistory];
  const temperature = aiConfig.model?.parameters?.temperature as number | undefined;

  try {
    const result = aiConfig.enabled
      ? await aiConfig
          .createTracker()
          .trackMetricsOf(toLDMetrics, () =>
            chatCompletion(tierConfig.model, messages, { temperature, webSearch }),
          )
      : await chatCompletion(tierConfig.model, messages, { temperature, webSearch });

    return NextResponse.json({ reply: result.reply, servedBy: tierConfig, webSearch });
  } catch (error) {
    console.error('[api/chat]', error);
    return NextResponse.json(
      { error: 'The chat backend is unreachable right now. Please try again shortly.' },
      { status: 502 },
    );
  }
}
