'use client';

import { LDProvider } from 'launchdarkly-react-client-sdk';
import type { LDContext } from 'launchdarkly-js-client-sdk';
import type { ReactNode } from 'react';

const clientSideID = process.env.NEXT_PUBLIC_LAUNCHDARKLY_CLIENT_ID;

/** Placeholder context until auth (milestone 5) provides a real logged-in user. */
const anonymousContext: LDContext = {
  kind: 'user',
  key: 'anonymous-visitor',
  anonymous: true,
};

export default function LDClientProvider({ children }: { children: ReactNode }) {
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
      context={anonymousContext}
      reactOptions={{ useCamelCaseFlagKeys: false }}
    >
      {children}
    </LDProvider>
  );
}
