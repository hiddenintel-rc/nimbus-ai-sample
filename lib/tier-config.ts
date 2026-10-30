export type TierModel = {
  /** Model ID sent to the inference backend (an Open WebUI / llama.cpp router ID). */
  id: string;
  label: string;
  /** Takes longer to load (a larger model or a separate context size), so the menu labels it. */
  slow?: boolean;
  /**
   * Key of this model's own AI Config, which supplies its prompt and
   * temperature and receives its tokens, feedback and judge scores. Without
   * one, or while that config is disabled, the model uses the shared
   * `nimbus-assistant` config (see aiConfigForModel).
   */
  aiConfigKey?: string;
};

export type LockedModel = {
  id: string;
  label: string;
  /** Plan name shown next to the greyed-out entry, e.g. "Pro". Read from the flag's `requiredTier` field. */
  requiredPlan: string;
};

export type TierConfig = {
  /** Models this tier may select. The server only ever calls one of these. */
  models: TierModel[];
  /** Shown greyed out in the picker as an upsell. Never accepted by the server. */
  lockedModels: LockedModel[];
  defaultModel: string;
  /**
   * How much of the conversation is replayed to the model, when
   * `enable-conversation-memory` is on for the account. A tier without memory
   * never reaches this.
   */
  maxContextMessages: number;
  /**
   * How many messages this plan may send in one conversation. Undefined means
   * unlimited, which is what the paid tiers serve. Unlike `maxContextMessages`
   * this is a hard stop, enforced server-side on every request, and it does
   * not depend on memory being on.
   */
  maxMessagesPerConversation?: number;
  label: string;
};

/**
 * Safe fallback if the `chat-tier-config` flag is unreachable or not yet
 * created — matches the "Free Tier" variation.
 */
export const DEFAULT_TIER_CONFIG: TierConfig = {
  models: [{ id: 'Qwen3.5-4B', label: 'Qwen 4B' }],
  lockedModels: [
    { id: 'Qwen3.5-4B-128k', label: 'Qwen 4B · long context', requiredPlan: 'Pro' },
    { id: 'Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL', label: 'Qwen Coder 30B', requiredPlan: 'Enterprise' },
    { id: 'Qwen3.8-27B-UD-Q3_K_XL', label: 'Qwen 3.8 27B', requiredPlan: 'Enterprise' },
  ],
  defaultModel: 'Qwen3.5-4B',
  maxContextMessages: 4,
  // No `maxMessagesPerConversation`: this fallback applies when LaunchDarkly
  // is unreachable, and the message quota is designed to fail open, so a
  // flag that can't be read never blocks a reply.
  label: 'Free',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

/**
 * Flag values are edited by hand in the LaunchDarkly dashboard, so anything
 * malformed falls back field by field instead of breaking the chat.
 */
export function normalizeTierConfig(raw: unknown): TierConfig {
  if (!isRecord(raw)) return DEFAULT_TIER_CONFIG;

  const models: TierModel[] = Array.isArray(raw.models)
    ? raw.models.filter(isRecord).flatMap((entry) =>
        nonEmptyString(entry.id)
          ? [
              {
                id: entry.id,
                label: nonEmptyString(entry.label) ? entry.label : entry.id,
                ...(entry.slow === true ? { slow: true } : {}),
                ...(nonEmptyString(entry.aiConfigKey) ? { aiConfigKey: entry.aiConfigKey.trim() } : {}),
              },
            ]
          : [],
      )
    : [];
  if (models.length === 0) return DEFAULT_TIER_CONFIG;

  const allowed = new Set(models.map((model) => model.id));
  const lockedModels: LockedModel[] = Array.isArray(raw.lockedModels)
    ? raw.lockedModels.filter(isRecord).flatMap((entry) =>
        nonEmptyString(entry.id) && !allowed.has(entry.id)
          ? [
              {
                id: entry.id,
                label: nonEmptyString(entry.label) ? entry.label : entry.id,
                requiredPlan: nonEmptyString(entry.requiredTier) ? entry.requiredTier : 'a higher plan',
              },
            ]
          : [],
      )
    : [];

  const defaultModel =
    nonEmptyString(raw.defaultModel) && allowed.has(raw.defaultModel)
      ? raw.defaultModel
      : models[0].id;

  const maxContextMessages = positiveInteger(raw.maxContextMessages) ?? DEFAULT_TIER_CONFIG.maxContextMessages;

  // Absent, zero or malformed all mean "no limit" — a tier only gets a quota
  // when its variation says so, so adding the field to one variation cannot
  // accidentally cap the others.
  const maxMessagesPerConversation = positiveInteger(raw.maxMessagesPerConversation);

  return {
    models,
    lockedModels,
    defaultModel,
    maxContextMessages,
    ...(maxMessagesPerConversation !== undefined ? { maxMessagesPerConversation } : {}),
    label: nonEmptyString(raw.label) ? raw.label : DEFAULT_TIER_CONFIG.label,
  };
}

/** Counts what the user has sent; assistant replies don't consume quota. */
export function countUserMessages(messages: readonly { role: string }[]): number {
  return messages.reduce((total, message) => (message.role === 'user' ? total + 1 : total), 0);
}

/**
 * Whether `userMessageCount` messages is more than this plan allows.
 *
 * Takes a count rather than the message list because the two callers are
 * asking different questions at different moments. The route counts the
 * history it was handed, which already includes the message being sent, so
 * the 4th message of a 4-message plan is `4 > 4` — allowed. The browser is
 * asking whether to let the user start another one, so it passes
 * `sent + 1`. Keeping the comparison in one place means the wall can't end
 * up one message apart on the two sides.
 */
export function overMessageLimit(tier: TierConfig, userMessageCount: number): boolean {
  return (
    tier.maxMessagesPerConversation !== undefined &&
    userMessageCount > tier.maxMessagesPerConversation
  );
}

/**
 * Picks the model that answers: the user's choice if this tier allows it,
 * otherwise the AI Config's model if this tier allows it, otherwise the
 * tier's default.
 */
export function resolveModel(
  tier: TierConfig,
  requested: unknown,
  aiConfigModel?: string,
): TierModel {
  const byId = (id: unknown) =>
    typeof id === 'string' ? tier.models.find((model) => model.id === id) : undefined;
  return (
    byId(requested) ??
    byId(aiConfigModel) ??
    byId(tier.defaultModel) ??
    tier.models[0]
  );
}
