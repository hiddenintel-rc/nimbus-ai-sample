'use client';

import { useEffect } from 'react';
import { useLDClient } from 'launchdarkly-react-client-sdk';
import type { LDContext } from 'launchdarkly-js-client-sdk';
import { anonymousContext } from '@/components/LDClientProvider';

/**
 * Re-identifies the client SDK when the logged-in user changes (login,
 * logout, switching demo accounts). Rendered from the page rather than the
 * root layout because layouts don't re-render on navigation, so a context
 * passed only to LDProvider would go stale after login/logout.
 */
export default function LDUserSync({ context }: { context?: LDContext }) {
  const ldClient = useLDClient();
  const target = context ?? anonymousContext;
  const targetKey = 'key' in target ? target.key : undefined;

  useEffect(() => {
    if (!ldClient) return;
    const current = ldClient.getContext();
    const currentKey = current && 'key' in current ? current.key : undefined;
    if (currentKey !== targetKey) {
      ldClient.identify(target);
    }
    // Re-run only when the user actually changes, not on every new object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ldClient, targetKey]);

  return null;
}
