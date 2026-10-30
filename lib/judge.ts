import {
  Judge,
  type LDAIClient,
  type LDAICompletionConfig,
  type LDAIConfigTracker,
  type LDAIJudgeConfigDefault,
  type Runner,
} from '@launchdarkly/server-sdk-ai';
import type { LDContext } from '@launchdarkly/node-server-sdk';
import { numericTemperature } from '@/lib/ai-config';
import { chatCompletion, type ChatMessage } from '@/lib/inference';

const JUDGE_TIMEOUT_MS = 60_000;

/** Returned for a judge key that doesn't exist in LaunchDarkly, which is then skipped. */
const DISABLED_JUDGE: LDAIJudgeConfigDefault = { enabled: false };

// The SDK's Judge asks its runner for structured output. This app's backend
// is a plain chat endpoint, so the format is asked for in words and the reply
// is parsed leniently; a reply that can't be read is dropped, not guessed at.
const OUTPUT_FORMAT =
  'Reply with only a JSON object and nothing else: ' +
  '{"score": <number from 0 to 1>, "reasoning": "<one sentence>"}';

function parseJudgement(text: string): Record<string, unknown> | undefined {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const judgement = value as Record<string, unknown>;
    // The SDK requires `reasoning`; rubrics LaunchDarkly generates ask for `rationale`.
    if (judgement.reasoning === undefined && typeof judgement.rationale === 'string') {
      judgement.reasoning = judgement.rationale;
    }
    return judgement;
  } catch {
    return undefined;
  }
}

/**
 * The SDK's own runners come from LaunchDarkly's provider packages, which pin
 * an older `openai` than this app uses. A Runner is one method, so the judge
 * runs on the same inference code as the chat instead.
 */
function judgeRunner(model: string, instructions: ChatMessage[], temperature?: number): Runner {
  return {
    async run(input) {
      const startedAt = Date.now();
      const completion = chatCompletion(
        model,
        [...instructions, { role: 'user', content: `${input}\n\n${OUTPUT_FORMAT}` }],
        { temperature, signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS) },
      );
      let step = await completion.next();
      while (!step.done) step = await completion.next();
      const { reply, usage } = step.value;
      return {
        content: reply,
        parsed: parseJudgement(reply),
        metrics: {
          success: true,
          durationMs: Date.now() - startedAt,
          ...(usage
            ? { tokens: { total: usage.totalTokens, input: usage.promptTokens, output: usage.completionTokens } }
            : {}),
        },
      };
    },
  };
}

/**
 * Scores a finished reply with every judge attached to the AI Config
 * variation that wrote it, and records each score on that reply's tracker,
 * so it is credited to the same variation as the reply's tokens and feedback.
 *
 * Which judges run, and on what share of replies, is set on the variation in
 * LaunchDarkly (its judge configuration), not here. Each judge is its own AI
 * Config in judge mode — see "Create the judge" in the README — so its rubric
 * and temperature are edited there too.
 *
 * The judge config's model is not used. LaunchDarkly's judge form only lists
 * hosted providers, and this app calls none of them, so every judge runs on
 * the AI Config variation's own model, and only on replies that model wrote.
 * A model with its own AI Config is therefore judged by itself, and a model
 * that falls back to the shared config is not judged. A single-GPU backend
 * loads one model at a time, so judging never unloads the model the user is
 * chatting with. Scores are comparable between variations of one config, not
 * between models.
 *
 * `history` should be the user and assistant turns only: the judge rates the
 * reply for the user, and the system prompt is what differs between arms.
 */
export async function runJudges({
  aiClient,
  aiConfig,
  context,
  tracker,
  history,
  reply,
  servedModel,
}: {
  aiClient: LDAIClient;
  aiConfig: LDAICompletionConfig;
  context: LDContext;
  tracker: LDAIConfigTracker;
  history: ChatMessage[];
  reply: string;
  servedModel: string;
}): Promise<void> {
  if (!servedModel || servedModel !== aiConfig.model?.name) return;
  for (const attached of aiConfig.judgeConfiguration?.judges ?? []) {
    try {
      const judgeConfig = await aiClient.judgeConfig(attached.key, context, DISABLED_JUDGE);
      if (!judgeConfig.enabled) continue;
      const judge = new Judge(
        judgeConfig,
        judgeRunner(
          servedModel,
          judgeConfig.messages ?? [],
          numericTemperature(judgeConfig.model?.parameters?.temperature),
        ),
        attached.samplingRate,
      );
      const result = await judge.evaluateMessages(history, { content: reply, metrics: { success: true } });
      if (result.sampled && result.score === undefined) {
        console.error(`[judge] ${attached.key} returned no usable score`, result.errorMessage ?? '');
      }
      tracker.trackJudgeResult(result);
    } catch (error) {
      console.error(`[judge] ${attached.key}`, error);
    }
  }
}
