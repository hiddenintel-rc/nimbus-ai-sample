'use client';

import { useFlags } from 'launchdarkly-react-client-sdk';
import Logo from '@/components/Logo';

/**
 * Gates the redesigned cloud + wordmark logo behind `new-logo` — the same
 * live-toggle pattern as MemoryStatusBadge, applied to a brand/visual
 * release instead of a product feature. Defaults to the new logo if the
 * flag hasn't loaded yet or doesn't exist, since that's the current design;
 * flip the flag off in LD to revert instantly to the plain text wordmark.
 */
export default function BrandLogo() {
  const flags = useFlags();
  const showNewLogo = flags['new-logo'] ?? true;

  if (showNewLogo) {
    return <Logo />;
  }

  return (
    <span className="text-lg font-semibold tracking-tight text-black dark:text-zinc-50">
      Nimbus
    </span>
  );
}
