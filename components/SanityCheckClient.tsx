'use client';

import { useFlags } from 'launchdarkly-react-client-sdk';

/**
 * Temporary: proves the client-side React SDK streams flag changes live.
 * Toggle `sanity-check` in the LD dashboard and this value updates with no reload.
 */
export default function SanityCheckClient() {
  const flags = useFlags();
  const value = flags['sanity-check'];

  return (
    <p className="text-sm text-zinc-500 dark:text-zinc-500">
      Client SDK live value of <code>sanity-check</code>:{' '}
      <span className="font-semibold text-black dark:text-zinc-50">{String(value)}</span>{' '}
      <span className="text-xs">(toggle it in the LD dashboard — updates with no reload)</span>
    </p>
  );
}
