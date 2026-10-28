'use client';

import { useFlags } from 'launchdarkly-react-client-sdk';

const BASE = 'rounded-full px-2.5 py-1 text-xs font-medium';
const NEUTRAL = `${BASE} bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400`;

/**
 * Live, no-reload indicator for `enable-conversation-memory`. Toggling the
 * flag in the LD dashboard flips this instantly via the client SDK's
 * streaming connection — the same mechanism the flag's trigger relies on
 * for remediation.
 *
 * The flag is missing from `useFlags()` until the SDK's first payload
 * arrives, and stays missing if the flag isn't available to client-side
 * SDKs. Reading that as `false` would claim memory is off while the server
 * is still forwarding history, so it shows an em dash instead of guessing.
 */
export default function MemoryStatusBadge() {
  const flags = useFlags();
  const value = flags['enable-conversation-memory'];

  if (value === undefined) {
    return <span className={NEUTRAL}>Memory: &mdash;</span>;
  }

  return (
    <span
      className={
        value
          ? `${BASE} bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400`
          : NEUTRAL
      }
    >
      Memory: {value ? 'On' : 'Off'}
    </span>
  );
}
