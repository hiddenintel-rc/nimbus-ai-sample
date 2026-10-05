export type TierModel = {
  /** Model ID sent to the inference backend (an Open WebUI / llama.cpp router ID). */
  id: string;
  label: string;
  /** Larger model or separate context stanza — the first reply after switching to it reloads it. */
  slow?: boolean;
};

export type LockedModel = {
  id: string;
  label: string;
  /** Plan name shown next to the greyed-out entry, e.g. "Pro". */
  requiredTier: string;
};

export type TierConfig = {
  /** Models this tier may select. The server only ever calls one of these. */
  models: TierModel[];
  /** Shown greyed out in the picker as an upsell. Never accepted by the server. */
  lockedModels: LockedModel[];
  defaultModel: string;
  maxContextMessages: number;
  label: string;
};

/**
 * Safe fallback if the `chat-tier-config` flag is unreachable or not yet
 * created — matches the "Free Tier" variation.
 */
export const DEFAULT_TIER_CONFIG: TierConfig = {
  models: [{ id: 'Qwen3.5-4B', label: 'Qwen 4B' }],
  lockedModels: [
    { id: 'Qwen3.5-4B-128k', label: 'Qwen 4B · long context', requiredTier: 'Pro' },
    { id: 'Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL', label: 'Qwen Coder 30B', requiredTier: 'Enterprise' },
    { id: 'Qwen3.8-27B-UD-Q3_K_XL', label: 'Qwen 3.8 27B', requiredTier: 'Enterprise' },
  ],
  defaultModel: 'Qwen3.5-4B',
  maxContextMessages: 4,
  label: 'Free',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Flag values are edited by hand in the LaunchDarkly dashboard, so anything
 * malformed falls back field by field instead of breaking the chat. Also
 * accepts the older single-model shape (`{ model, maxContextMessages, label }`)
 * so the app keeps working while the variations are being migrated.
 */
export function normalizeTierConfig(raw: unknown): TierConfig {
  if (!isRecord(raw)) return DEFAULT_TIER_CONFIG;

  let models: TierModel[] = Array.isArray(raw.models)
    ? raw.models.filter(isRecord).flatMap((entry) =>
        nonEmptyString(entry.id)
          ? [
              {
                id: entry.id,
                label: nonEmptyString(entry.label) ? entry.label : entry.id,
                ...(entry.slow === true ? { slow: true } : {}),
              },
            ]
          : [],
      )
    : [];
  if (models.length === 0 && nonEmptyString(raw.model)) {
    models = [{ id: raw.model, label: raw.model }];
  }
  if (models.length === 0) return DEFAULT_TIER_CONFIG;

  const allowed = new Set(models.map((model) => model.id));
  const lockedModels: LockedModel[] = Array.isArray(raw.lockedModels)
    ? raw.lockedModels.filter(isRecord).flatMap((entry) =>
        nonEmptyString(entry.id) && !allowed.has(entry.id)
          ? [
              {
                id: entry.id,
                label: nonEmptyString(entry.label) ? entry.label : entry.id,
                requiredTier: nonEmptyString(entry.requiredTier) ? entry.requiredTier : 'a higher plan',
              },
            ]
          : [],
      )
    : [];

  const defaultModel =
    nonEmptyString(raw.defaultModel) && allowed.has(raw.defaultModel)
      ? raw.defaultModel
      : models[0].id;

  const maxContextMessages =
    typeof raw.maxContextMessages === 'number' &&
    Number.isInteger(raw.maxContextMessages) &&
    raw.maxContextMessages > 0
      ? raw.maxContextMessages
      : DEFAULT_TIER_CONFIG.maxContextMessages;

  return {
    models,
    lockedModels,
    defaultModel,
    maxContextMessages,
    label: nonEmptyString(raw.label) ? raw.label : DEFAULT_TIER_CONFIG.label,
  };
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
