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
import {
  countUserMessages,
  DEFAULT_TIER_CONFIG,
  normalizeTierConfig,
  overMessageLimit,
  resolveModel,
} from '@/lib/tier-config';
import { AI_CONFIG_KEY, DEFAULT_AI_CONFIG, numericTemperature } from '@/lib/ai-config';
import { UNREACHABLE_MESSAGE, type ServedBy } from '@/lib/chat-stream';
import { signFeedbackToken } from '@/lib/feedback-token';
import { runJudges } from '@/lib/judge';
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

const KEEPALIVE_MS = 20_000;
const encoder = new TextEncoder();

function sse(payload: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

/** An SSE comment. Browsers ignore it; Cloudflare counts it as a read. */
function keepalive(): Uint8Array {
  return encoder.encode(`: keepalive\n\n`);
}

/** Writes a keepalive every KEEPALIVE_MS until the returned function is called. */
function startKeepalive(controller: ReadableStreamDefaultController<Uint8Array>): () => void {
  const beat = setInterval(() => {
    try {
      controller.enqueue(keepalive());
    } catch {
      clearInterval(beat);
    }
  }, KEEPALIVE_MS);
  return () => clearInterval(beat);
}

function sseResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    },
  });
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

/**
 * The SDK holds events until its own flush interval, which a serverless
 * instance can be frozen before reaching. Called once the reply has been
 * delivered, so it costs the user nothing.
 */
async function flushMetrics(tracker: LDAIConfigTracker | null) {
  if (!tracker) return;
  try {
    const client = await getLDClient();
    await client.flush();
  } catch (error) {
    console.error('[api/chat] metrics flush', error);
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
  const history: IncomingMessage[] | null = isValidHistory(body?.messages) ? body.messages : null;

  if (!history) {
    return NextResponse.json({ error: 'messages is required' }, { status: 400 });
  }

  const client = await getLDClient();
  const context = buildUserContext(session.user);

  // The flag keys below must exist in your own LaunchDarkly environment —
  // see "Re-create the LaunchDarkly flags" in the README for exact keys,
  // variations, and targeting. The default values passed here are what the
  // SDK returns when LaunchDarkly is unreachable or a flag doesn't exist:
  // a conservative free-plan fallback, not a substitute for creating the flags.
  const memoryEnabled = await client.variation('enable-conversation-memory', context, false);
  const tierConfig = normalizeTierConfig(
    await client.variation('chat-tier-config', context, DEFAULT_TIER_CONFIG),
  );
  // The plan's message allowance, enforced before anything is spent on the
  // request. `history` already includes the message being sent, so this is
  // the decision for *this* message, not the next one. A browser that ignores
  // its own disabled composer still lands here.
  if (overMessageLimit(tierConfig, countUserMessages(history))) {
    return NextResponse.json(
      {
        error: `The ${tierConfig.label} plan includes ${tierConfig.maxMessagesPerConversation} messages per conversation.`,
        limitReached: true,
        limit: tierConfig.maxMessagesPerConversation,
      },
      { status: 403 },
    );
  }

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
    // Streamed for the same reason chat is: a cold ComfyUI start can run past
    // the proxy's read timeout, and a single JSON body sends nothing until the
    // end. Cut off there, the browser would never see the upstream error.
    return sseResponse(
      new ReadableStream({
        async start(controller) {
          controller.enqueue(keepalive());
          const stopKeepalive = startKeepalive(controller);
          try {
            const image = await generateImage(prompt);
            controller.enqueue(
              sse({
                type: 'image',
                reply: 'Generated from your prompt.',
                images: [{ src: image.dataUrl, alt: prompt }],
              }),
            );
          } catch (error) {
            console.error('[api/chat] image', error);
            const message =
              error instanceof Error ? error.message : 'Image generation failed. Please try again shortly.';
            try {
              controller.enqueue(sse({ type: 'error', error: message }));
            } catch {
              // The browser already left.
            }
          } finally {
            stopKeepalive();
            try {
              controller.close();
            } catch {
              // Already closed by the client.
            }
          }
        },
      }),
    );
  }

  // The AI Config supplies the prompt and temperature for every
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

  // With memory off, only the latest message is sent, so every turn is
  // answered as a new conversation. With memory on, the tier config's context
  // window caps how much history this account's plan may carry.
  // Only role and content go upstream. The browser's copy of each message
  // also carries UI state (captions, citations, feedback tokens).
  const relevantHistory: ChatMessage[] = (
    memoryEnabled ? history.slice(-tierConfig.maxContextMessages) : history.slice(-1)
  ).map(({ role, content }) => ({ role, content }));

  const systemMessages: ChatMessage[] =
    aiConfig.enabled && aiConfig.messages?.length ? aiConfig.messages : (DEFAULT_AI_CONFIG.messages ?? []);

  const messages: ChatMessage[] = [...systemMessages, ...relevantHistory];
  const temperature = numericTemperature(aiConfig.model?.parameters?.temperature);
  const servedBy: ServedBy = { model: model.id, modelLabel: model.label, planLabel: tierConfig.label };
  const tracker = aiConfig.enabled ? aiConfig.createTracker() : null;
  // Lets a later 👍 / 👎 reach this exact run — see lib/feedback-token.ts.
  const feedbackToken = tracker ? signFeedbackToken(tracker.resumptionToken, session.user.id) : undefined;
  const startedAt = Date.now();
  // Cancelled when the browser disconnects or this response stream is cancelled.
  const upstream = new AbortController();
  const onClientAbort = () => upstream.abort();
  request.signal.addEventListener('abort', onClientAbort, { once: true });

  const stream = new ReadableStream({
    async start(controller) {
      const stopKeepalive = startKeepalive(controller);

      let firstTokenAt: number | undefined;
      let result: ChatCompletionResult | undefined;
      let failed = false;

      try {
        // Sent before the model loads, so the proxy receives bytes during a model swap.
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
            ...(feedbackToken ? { feedbackToken } : {}),
          }),
        );
      } catch (error) {
        failed = true;
        console.error('[api/chat]', error);
        // The browser already left; writing an error event has nowhere to go.
        if (!request.signal.aborted && !upstream.signal.aborted) {
          try {
            controller.enqueue(sse({ type: 'error', error: UNREACHABLE_MESSAGE }));
          } catch {
            // The stream closed between the failure and this write.
          }
        }
      } finally {
        stopKeepalive();
        request.signal.removeEventListener('abort', onClientAbort);
        recordMetrics(tracker, result, startedAt, firstTokenAt, failed);
        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
        // After the reply is delivered, so the user never waits on the judge.
        // It does occupy the GPU for a moment, which is why the variation's
        // sampling rate decides how many replies are judged.
        if (tracker && !failed && result && result.reply.trim().length > 0) {
          await runJudges({
            aiClient,
            aiConfig,
            context,
            tracker,
            history: relevantHistory,
            reply: result.reply,
            servedModel: model.id,
          });
        }
        await flushMetrics(tracker);
      }
    },
    cancel() {
      upstream.abort();
    },
  });

  return sseResponse(stream);
}
