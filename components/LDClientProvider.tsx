'use client';

import { LDProvider } from 'launchdarkly-react-client-sdk';
import type { LDContext } from 'launchdarkly-js-client-sdk';
import type { ReactNode } from 'react';

const clientSideID = process.env.NEXT_PUBLIC_LAUNCHDARKLY_CLIENT_ID;

/** Used for logged-out visitors, who have no demo account to identify as. */
export const anonymousContext: LDContext = {
  kind: 'user',
  key: 'anonymous-visitor',
  anonymous: true,
};

/**
 * `initialContext` is the logged-in user's context, built server-side from
 * the session (same builder as /api/chat), so client-side flags evaluate
 * against the same user the server does. LDProvider only reads it once at
 * startup — later login/logout changes are handled by LDUserSync.
 */
export default function LDClientProvider({
  children,
  initialContext,
}: {
  children: ReactNode;
  initialContext?: LDContext;
}) {
  if (!clientSideID) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        '[LaunchDarkly] NEXT_PUBLIC_LAUNCHDARKLY_CLIENT_ID is not set — flags will not load. ' +
          'Copy .env.example to .env.local and fill it in.',
      );
    }
    return <>{children}</>;
  }

  return (
    <LDProvider
      clientSideID={clientSideID}
      context={initialContext ?? anonymousContext}
      reactOptions={{ useCamelCaseFlagKeys: false }}
    >
      {children}
    </LDProvider>
  );
}
