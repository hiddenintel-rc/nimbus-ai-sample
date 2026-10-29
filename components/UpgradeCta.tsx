'use client';

import { useState } from 'react';

/**
 * The upsell button; the caller decides who sees it (ChatPanel shows it to
 * free-tier accounts). Clicking it fires the `clicked-upgrade` event behind
 * the `upgrade-interest` metric, which the show-plan-comparison experiment
 * measures. There is no checkout behind it; it only records intent.
 */
export default function UpgradeCta() {
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');

  async function handleClick() {
    if (state !== 'idle') return;
    setState('sending');
    try {
      await fetch('/api/track-upgrade', { method: 'POST' });
    } finally {
      setState('done');
    }
  }

  if (state === 'done') {
    return (
      <p className="text-xs text-zinc-500 dark:text-zinc-500">
        Thanks for your interest &mdash; this is a demo, so there&apos;s no real checkout here.
      </p>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state === 'sending'}
      className="self-start rounded-lg border border-black/[.1] px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-black/[.3] disabled:opacity-50 dark:border-white/[.145] dark:text-zinc-300"
    >
      Upgrade to Pro
    </button>
  );
}
