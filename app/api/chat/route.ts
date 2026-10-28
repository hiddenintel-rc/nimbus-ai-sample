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
import { modelContextTokens } from '@/lib/model-context';
import type { LDAIConfigTracker } from '@launchdarkly/server-sdk-ai';

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

type ServedBy = { model: string; modelLabel: string; label: string };

const KEEPALIVE_MS = 20_000;
const encoder = new TextEncoder();

function sse(payload: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

/** An SSE comment. Browsers ignore it; Cloudflare counts it as a read. */
function keepalive(): Uint8Array {
  return encoder.encode(`: keepalive\n\n`);
}

function recordMetrics(
  tracker: LDAIConfigTracker | null,
  result: ChatCompletionResult | undefined,
  startedAt: number,
  firstTokenAt: number | undefined,
  failed: boolean,
) {
  if (!tracker) return;
  try {
    if (failed) tracker.trackError();
    else tracker.trackSuccess();
    if (result?.usage) {
      tracker.trackTokens({
        total: result.usage.totalTokens,
        input: result.usage.promptTokens,
        output: result.usage.completionTokens,
      });
    }
    if (firstTokenAt !== undefined) tracker.trackTimeToFirstToken(firstTokenAt - startedAt);
    tracker.trackDuration(Date.now() - startedAt);
  } catch (error) {
    console.error('[api/chat] metrics', error);
  }
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
  const servedBy: ServedBy = { model: model.id, modelLabel: model.label, label: tierConfig.label };
  const tracker = aiConfig.enabled ? aiConfig.createTracker() : null;
  const startedAt = Date.now();
  // Cancelled when the browser disconnects or this response stream is cancelled.
  const upstream = new AbortController();
  const onClientAbort = () => upstream.abort();
  request.signal.addEventListener('abort', onClientAbort, { once: true });

  const stream = new ReadableStream({
    async start(controller) {
      const beat = setInterval(() => {
        try {
          controller.enqueue(keepalive());
        } catch {
          clearInterval(beat);
        }
      }, KEEPALIVE_MS);

      let firstTokenAt: number | undefined;
      let result: ChatCompletionResult | undefined;
      let failed = false;

      try {
        // Goes out before the model is loaded, so the edge sees bytes during a swap.
        const maxTokens = modelContextTokens(model.id);
        controller.enqueue(
          sse({
            type: 'meta',
            servedBy,
            webSearch,
            ...(maxTokens !== undefined ? { maxTokens } : {}),
          }),
        );

        const completion = chatCompletion(model.id, messages, {
          temperature,
          webSearch,
          signal: upstream.signal,
        });

        while (true) {
          const step = await completion.next();
          if (step.done) {
            result = step.value;
            break;
          }
          if (firstTokenAt === undefined && step.value.text.length > 0) firstTokenAt = Date.now();
          controller.enqueue(
            sse({
              type: 'delta',
              text: step.value.text,
              completionTokens: step.value.completionTokens,
              ...(step.value.promptTokens !== undefined
                ? { promptTokens: step.value.promptTokens }
                : {}),
            }),
          );
        }

        controller.enqueue(
          sse({
            type: 'done',
            citations: result.citations ?? [],
            ...(result.usage ? { usage: result.usage } : {}),
          }),
        );
      } catch (error) {
        failed = true;
        console.error('[api/chat]', error);
        // The browser already left; writing an error event has nowhere to go.
        if (!request.signal.aborted && !upstream.signal.aborted) {
          try {
            controller.enqueue(
              sse({
                type: 'error',
                error: 'The chat backend is unreachable right now. Please try again shortly.',
              }),
            );
          } catch {
            // The stream closed between the failure and this write.
          }
        }
      } finally {
        clearInterval(beat);
        request.signal.removeEventListener('abort', onClientAbort);
        recordMetrics(tracker, result, startedAt, firstTokenAt, failed);
        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
      }
    },
    cancel() {
      upstream.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
