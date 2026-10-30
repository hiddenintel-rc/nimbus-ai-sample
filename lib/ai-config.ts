import type { LDContext } from '@launchdarkly/node-server-sdk';
import type {
  LDAIClient,
  LDAICompletionConfig,
  LDAICompletionConfigDefault,
} from '@launchdarkly/server-sdk-ai';
import type { TierModel } from '@/lib/tier-config';

/**
 * Must exist in your own LaunchDarkly environment as an AI Config in
 * completion mode — see "Create the AI Config" in the README. Supplies the
 * prompt/temperature for every model without a config of its own; its model
 * is only the default pick, and only for tiers whose chat-tier-config allows
 * it (see resolveModel).
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

/**
 * The AI Config for the model that answers: the model's own config when the
 * tier flag names one and it is enabled, otherwise the shared one. Its
 * tracker then credits tokens, feedback and judge scores to that model.
 *
 * A missing config is disabled, so naming a key before creating its config
 * falls back to the shared one instead of dropping the prompt.
 */
export async function aiConfigForModel(
  aiClient: LDAIClient,
  model: TierModel,
  context: LDContext,
  shared: LDAICompletionConfig,
): Promise<LDAICompletionConfig> {
  if (!model.aiConfigKey || model.aiConfigKey === AI_CONFIG_KEY) return shared;
  const own = await aiClient.completionConfig(model.aiConfigKey, context);
  if (!own.enabled) return shared;
  if (own.model?.name !== model.id) {
    // The tracker reports the config's model, so its events would be
    // credited to a model that never answered, and its judges are skipped.
    console.warn(`[ai-config] ${model.aiConfigKey} names model ${own.model?.name ?? '(none)'}, but ${model.id} answers`);
  }
  return own;
}
