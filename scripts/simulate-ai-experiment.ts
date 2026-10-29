/**
 * Generates synthetic chat traffic against the `nimbus-assistant` AI Config
 * so the prompt experiment on it (control: the current prompt, treatment:
 * the `structured-concise` variation) has enough sample size for
 * LaunchDarkly's results page to show a real readout. This app has no
 * production audience and the home lab has one GPU, so no model is called:
 * each session records made-up metrics on a real AI Config tracker, through
 * the same SDK calls /api/chat and /api/feedback make. Documented as
 * synthetic throughout, not an attempt to fabricate a conclusion.
 *
 * Per session, on the variation LaunchDarkly assigns:
 * - success, input/output tokens, time to first token and duration
 * - a 👍 / 👎 on some sessions (most people never rate a reply)
 * - a judge score on the share of sessions the variation's judge
 *   configuration samples, under the judge config's own metric key, so an
 *   arm without the judge attached gets no scores, as it would for real
 *
 * The rates below are made up, deliberately better for the treatment on
 * feedback and judge score and cheaper on output tokens, to produce a
 * readable effect. Real traffic would just be whatever it is.
 *
 * Usage: npm run simulate:ai-experiment [session count, default 4000]
 */
import { init, type LDContext } from '@launchdarkly/node-server-sdk';
import { initAi, LDFeedbackKind } from '@launchdarkly/server-sdk-ai';
import { AI_CONFIG_KEY, DEFAULT_AI_CONFIG } from '../lib/ai-config';
import { ldLogger } from '../lib/ld-logger';
import { loadEnvLocal } from './load-env';

loadEnvLocal();

const SDK_KEY = process.env.LAUNCHDARKLY_SDK_KEY;
if (!SDK_KEY) {
  console.error('LAUNCHDARKLY_SDK_KEY is not set — check .env.local.');
  process.exit(1);
}

const SESSION_COUNT = Number(process.argv[2] ?? 4000);
const FLUSH_EVERY = 500;

/** Variation key of the treatment arm — see "AI Config experiment" in the README. */
const TREATMENT_VARIATION = 'structured-concise';
/** The judge attached to both variations. Its metric key is read from LaunchDarkly. */
const JUDGE_KEY = 'nimbus-judge-helpfulness';

type Arm = 'control' | 'treatment';

// Synthetic, documented-as-such behaviour per arm.
const PROFILE: Record<
  Arm,
  { outputTokens: [number, number]; positiveRate: number; judgeScore: [number, number] }
> = {
  control: { outputTokens: [230, 70], positiveRate: 0.6, judgeScore: [0.66, 0.15] },
  treatment: { outputTokens: [150, 45], positiveRate: 0.7, judgeScore: [0.74, 0.13] },
};
const INPUT_TOKENS: [number, number] = [320, 40];
const TIME_TO_FIRST_TOKEN_MS: [number, number] = [450, 120];
const MS_PER_OUTPUT_TOKEN = 28;
const FEEDBACK_RATE = 0.35;

/** Normally distributed sample (Box–Muller), clamped to [min, max]. */
function normal([mean, sd]: [number, number], min: number, max = Infinity): number {
  const u = 1 - Math.random();
  const v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.min(max, Math.max(min, mean + sd * z));
}

const TIERS = ['free', 'pro', 'enterprise'] as const;

function makeContext(index: number): LDContext {
  return {
    kind: 'user',
    key: `sim-ai-user-${index}`,
    email: `sim-ai-user-${index}@example.com`,
    tier: TIERS[index % TIERS.length],
    accountAgeDays: Math.floor(Math.random() * 400),
  };
}

async function main() {
  const client = init(SDK_KEY!, { logger: ldLogger });
  await client.waitForInitialization({ timeout: 10 });
  const aiClient = initAi(client);

  const judgeConfig = await aiClient.judgeConfig(JUDGE_KEY, makeContext(0), { enabled: false });
  const judgeMetricKey = judgeConfig.enabled ? judgeConfig.evaluationMetricKey?.trim() : undefined;
  if (!judgeMetricKey) {
    console.log(`Judge "${JUDGE_KEY}" not found or has no metric key — no judge scores will be sent.`);
  }

  const stats: Record<Arm, { sessions: number; positive: number; negative: number; judged: number }> = {
    control: { sessions: 0, positive: 0, negative: 0, judged: 0 },
    treatment: { sessions: 0, positive: 0, negative: 0, judged: 0 },
  };
  const otherVariations = new Set<string>();

  for (let i = 0; i < SESSION_COUNT; i++) {
    const context = makeContext(i);
    const aiConfig = await aiClient.completionConfig(AI_CONFIG_KEY, context, DEFAULT_AI_CONFIG);
    const tracker = aiConfig.createTracker();
    const { variationKey } = tracker.getTrackData();
    const arm: Arm = variationKey === TREATMENT_VARIATION ? 'treatment' : 'control';
    if (arm === 'control' && variationKey !== AI_CONFIG_KEY) otherVariations.add(variationKey);
    const profile = PROFILE[arm];
    stats[arm].sessions++;

    const input = Math.round(normal(INPUT_TOKENS, 50));
    const output = Math.round(normal(profile.outputTokens, 20));
    const firstToken = Math.round(normal(TIME_TO_FIRST_TOKEN_MS, 80));
    tracker.trackSuccess();
    tracker.trackTokens({ total: input + output, input, output });
    tracker.trackTimeToFirstToken(firstToken);
    tracker.trackDuration(firstToken + output * MS_PER_OUTPUT_TOKEN);

    if (Math.random() < FEEDBACK_RATE) {
      const positive = Math.random() < profile.positiveRate;
      tracker.trackFeedback({ kind: positive ? LDFeedbackKind.Positive : LDFeedbackKind.Negative });
      stats[arm][positive ? 'positive' : 'negative']++;
    }

    const judgeRate =
      aiConfig.judgeConfiguration?.judges.find((judge) => judge.key === JUDGE_KEY)?.samplingRate ?? 0;
    if (judgeMetricKey && Math.random() < judgeRate) {
      tracker.trackJudgeResult({
        judgeConfigKey: JUDGE_KEY,
        success: true,
        sampled: true,
        metricKey: judgeMetricKey,
        score: Math.round(normal(profile.judgeScore, 0, 1) * 100) / 100,
      });
      stats[arm].judged++;
    }

    if ((i + 1) % FLUSH_EVERY === 0) await client.flush();
  }

  await client.flush();

  console.log(`Simulated ${SESSION_COUNT} synthetic chat sessions on ${AI_CONFIG_KEY}.`);
  for (const arm of ['control', 'treatment'] as const) {
    const s = stats[arm];
    const rated = s.positive + s.negative;
    console.log(
      `  ${arm.padEnd(9)} ${String(s.sessions).padStart(5)} sessions, ` +
        `${rated} rated (${rated ? Math.round((100 * s.positive) / rated) : 0}% positive), ${s.judged} judged`,
    );
  }
  if (stats.treatment.sessions === 0) {
    console.log(`  No session got "${TREATMENT_VARIATION}" — is the experiment started on ${AI_CONFIG_KEY}?`);
  }
  if (otherVariations.size > 0) {
    console.log(`  Counted as control, but served: ${[...otherVariations].join(', ')}`);
  }

  client.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
