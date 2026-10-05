import { NextResponse } from 'next/server';
import {
  chatCompletion,
  generateImage,
  supportsImageGeneration,
  supportsWebSearch,
  type ChatCompletionResult,
  type ChatMessage,
} from '@/lib/inference';
import { getLDClient, getAiClient, buildUserContext } from '@/lib/ld-server';
import { auth } from '@/lib/auth';
import { DEFAULT_TIER_CONFIG, normalizeTierConfig, resolveModel } from '@/lib/tier-config';
import { AI_CONFIG_KEY, DEFAULT_AI_CONFIG } from '@/lib/ai-config';
import type { LDAIMetrics } from '@launchdarkly/server-sdk-ai';

// 60s is the max Vercel allows on the Hobby plan; image generation (~50s in
// testing) fits under it but with little headroom. Raise this if the project
// moves to a paid plan.
export const maxDuration = 60;

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

  // The flag keys below must exist in your own LaunchDarkly environment —
  // see "Re-create the LaunchDarkly flags" in the README for exact keys,
  // variations, and targeting. The default values passed here only cover
  // LaunchDarkly being briefly unreachable, not a missing/never-created flag.
  const memoryEnabled = await client.variation('enable-conversation-memory', context, false);
  const tierConfig = normalizeTierConfig(
    await client.variation('chat-tier-config', context, DEFAULT_TIER_CONFIG),
  );
  const webSearchEnabled = await client.variation('enable-web-search', context, false);
  const imageGenerationEnabled = await client.variation('enable-image-generation', context, false);

  // The browser's toggles are only requests. Search and image generation run
  // when the flag allows them for this account and the backend supports them,
  // never just because the client asked. An image request takes the turn:
  // the prompt goes to Open WebUI's image API instead of the chat model.
  const webSearch = webSearchEnabled && body?.webSearch === true && supportsWebSearch();
  const imageGeneration =
    imageGenerationEnabled && body?.imageGeneration === true && supportsImageGeneration();

  if (imageGeneration) {
    const latest = history[history.length - 1];
    if (!latest || latest.role !== 'user') {
      return NextResponse.json({ error: 'messages must end with a user prompt' }, { status: 400 });
    }
    const prompt = latest.content;
    try {
      const image = await generateImage(prompt);
      return NextResponse.json({
        reply: 'Generated from your prompt.',
        images: [{ src: image.dataUrl, alt: prompt }],
        imageGeneration: true,
      });
    } catch (error) {
      console.error('[api/chat] image', error);
      const message =
        error instanceof Error ? error.message : 'Image generation failed. Please try again shortly.';
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  // AI Config (AgentControl) supplies the prompt and temperature for every
  // account, and its model becomes the default pick — but only when this
  // tier's chat-tier-config allows that model. The user's own pick from the
  // model menu wins, and is likewise ignored unless the tier allows it.
  // Must exist in your own LD environment — see "Create the AI Config" in
  // the README.
  const aiClient = await getAiClient();
  const aiConfig = await aiClient.completionConfig(AI_CONFIG_KEY, context, DEFAULT_AI_CONFIG);
  const model = resolveModel(
    tierConfig,
    body?.model,
    aiConfig.enabled ? aiConfig.model?.name : undefined,
  );

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
            chatCompletion(model.id, messages, { temperature, webSearch }),
          )
      : await chatCompletion(model.id, messages, { temperature, webSearch });

    return NextResponse.json({
      reply: result.reply,
      servedBy: { model: model.id, modelLabel: model.label, label: tierConfig.label },
      webSearch,
      citations: result.citations ?? [],
    });
  } catch (error) {
    console.error('[api/chat]', error);
    return NextResponse.json(
      { error: 'The chat backend is unreachable right now. Please try again shortly.' },
      { status: 502 },
    );
  }
}
