/**
 * Context window, in tokens, that the backend loads each model ID with: the
 * llama.cpp `ctx-size` configured for that model on the self-hosted backend.
 * A reply cannot use more. Update these if the backend's settings change.
 */
const MODEL_CONTEXT_TOKENS: Record<string, number> = {
  'Qwen3.5-4B': 32_768,
  'Qwen3.5-4B-128k': 131_072,
  'Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL': 24_576,
  'Qwen3.8-27B-UD-Q3_K_XL': 24_576,
};

/** Tokens this model can hold, or undefined when the id is not one of the local routers. */
export function modelContextTokens(modelId: string): number | undefined {
  return MODEL_CONTEXT_TOKENS[modelId];
}
