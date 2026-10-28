import { init, type LDClient, type LDContext } from '@launchdarkly/node-server-sdk';
import { initAi, type LDAIClient } from '@launchdarkly/server-sdk-ai';
import type { Tier } from '@/lib/demo-users';

let clientPromise: Promise<LDClient> | undefined;
let aiClient: LDAIClient | undefined;

function getSdkKey(): string {
  const key = process.env.LAUNCHDARKLY_SDK_KEY;
  if (!key) {
    throw new Error(
      'LAUNCHDARKLY_SDK_KEY is not set. Copy .env.example to .env.local and fill it in.',
    );
  }
  return key;
}

/**
 * Server-side LD client singleton. The SDK recommends initializing once at
 * startup and reusing the instance, not creating a new client per request.
 *
 * A failed or timed-out initialization resolves with the client anyway: the
 * SDK keeps retrying the connection on its own, and `variation()` on a client
 * that isn't ready returns the default value passed at the call site (or the
 * last known one). Rejecting here would instead cache the rejection in
 * `clientPromise` for the life of the process, so one blip would keep every
 * later request failing long after LaunchDarkly came back.
 */
export function getLDClient(): Promise<LDClient> {
  if (!clientPromise) {
    const client = init(getSdkKey());
    clientPromise = client
      .waitForInitialization({ timeout: 10 })
      .then(() => client)
      .catch((error) => {
        console.error(
          '[LaunchDarkly] initialization did not complete — serving the fallback ' +
            'values passed at each call site until it does',
          error,
        );
        return client;
      });
  }
  return clientPromise;
}

/**
 * AI SDK wrapper around the same base client above — initAi() only needs
 * variation()/track(), which the server SDK client already provides.
 */
export async function getAiClient(): Promise<LDAIClient> {
  if (!aiClient) {
    const client = await getLDClient();
    aiClient = initAi(client);
  }
  return aiClient;
}

/**
 * Builds the LD context for a logged-in demo user. `key` is what individual
 * targeting matches on and `tier` is what the rules on `chat-tier-config`
 * match on. `accountAgeDays` is sent so a second attribute is available to
 * target on, but no rule uses it yet; it is there for a loyalty-style rule
 * (e.g. accountAgeDays >= 365 serves a higher tier).
 */
export function buildUserContext(user: {
  id: string;
  email: string;
  tier: Tier;
  accountAgeDays: number;
}): LDContext {
  return {
    kind: 'user',
    key: user.id,
    email: user.email,
    tier: user.tier,
    accountAgeDays: user.accountAgeDays,
  };
}
