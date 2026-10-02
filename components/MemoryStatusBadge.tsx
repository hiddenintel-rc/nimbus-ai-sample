'use client';

import { useFlags } from 'launchdarkly-react-client-sdk';

/**
 * Live, no-reload indicator for `enable-conversation-memory`. Toggling the
 * flag in the LD dashboard flips this instantly via the client SDK's
 * streaming connection — the same mechanism the flag's trigger relies on
 * for remediation.
 */
export default function MemoryStatusBadge() {
  const flags = useFlags();
  const enabled = Boolean(flags['enable-conversation-memory']);

  return (
    <span
      className={
        enabled
          ? 'rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
          : 'rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400'
      }
    >
      Memory: {enabled ? 'On' : 'Off'}
    </span>
  );
}
