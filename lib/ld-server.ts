import { init, type LDClient, type LDContext } from '@launchdarkly/node-server-sdk';

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

/** Placeholder context until auth (milestone 5) provides a real logged-in user. */
export const anonymousContext: LDContext = {
  kind: 'user',
  key: 'anonymous-visitor',
  anonymous: true,
};
