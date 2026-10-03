export type TierConfig = {
  model: string;
  maxContextMessages: number;
  label: string;
};

/**
 * Safe fallback if the `chat-tier-config` flag is unreachable or not yet
 * created — matches the shape of the "free" variation.
 */
export const DEFAULT_TIER_CONFIG: TierConfig = {
  model: 'Qwen3.5-4B',
  maxContextMessages: 4,
  label: 'Free',
};
