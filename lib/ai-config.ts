import type { LDAICompletionConfigDefault } from '@launchdarkly/server-sdk-ai';

/**
 * Must exist in your own LaunchDarkly environment as an AI Config in
 * completion mode — see "Create the AI Config" in the README. Supplies the
 * prompt/temperature for everyone; its model is only the default pick, and
 * only for tiers whose chat-tier-config allows it (see resolveModel).
 */
export const AI_CONFIG_KEY = 'nimbus-assistant';

/**
 * Used only if the AI Config above doesn't exist or LaunchDarkly is
 * unreachable. The model is the free tier's default, so every tier allows it.
 */
export const DEFAULT_AI_CONFIG: LDAICompletionConfigDefault = {
  enabled: true,
  model: {
    name: 'Qwen3.5-4B',
    parameters: { temperature: 0.7 },
  },
  messages: [
    {
      role: 'system',
      content: 'You are the Nimbus assistant, a helpful AI chat demo. Keep replies concise.',
    },
  ],
};

/**
 * AI Config parameters are typed `unknown` and entered by hand in the
 * dashboard, so a non-numeric `temperature` is dropped instead of being sent
 * to the inference call, where it would fail the whole request upstream.
 */
export function numericTemperature(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value !== undefined) {
    console.error('[ai-config] ignoring non-numeric temperature:', value);
  }
  return undefined;
}
