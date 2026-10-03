import type { LDAICompletionConfigDefault } from '@launchdarkly/server-sdk-ai';

/**
 * Must exist in your own LaunchDarkly environment as an AgentControl config
 * (completion mode) — see "Create the AI Config" in the README. This is a
 * separate concern from chat-tier-config: this controls the assistant's
 * prompt/temperature for everyone, not which model backend a tier gets.
 */
export const AI_CONFIG_KEY = 'nimbus-assistant';

/** Used only if the AI Config above doesn't exist yet or LD is unreachable. */
export const DEFAULT_AI_CONFIG: LDAICompletionConfigDefault = {
  enabled: true,
  model: {
    name: 'nimbus-default',
    parameters: { temperature: 0.7 },
  },
  messages: [
    {
      role: 'system',
      content: 'You are the Nimbus assistant, a helpful AI chat demo. Keep replies concise.',
    },
  ],
};
