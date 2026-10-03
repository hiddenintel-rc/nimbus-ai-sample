import { init, type LDClient, type LDContext } from '@launchdarkly/node-server-sdk';
import type { Tier } from '@/lib/demo-users';

let clientPromise: Promise<LDClient> | undefined;

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
 */
export function getLDClient(): Promise<LDClient> {
  if (!clientPromise) {
    const client = init(getSdkKey());
    clientPromise = client.waitForInitialization({ timeout: 10 }).then(() => client);
  }
  return clientPromise;
}

/**
 * Builds the LD context for a logged-in demo user. `key` is what individual
 * targeting matches on; `tier` and `accountAgeDays` drive rule-based targeting.
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
