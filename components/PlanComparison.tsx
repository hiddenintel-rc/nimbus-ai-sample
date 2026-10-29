'use client';

import { useFlags } from 'launchdarkly-react-client-sdk';
import type { Tier } from '@/lib/demo-users';

type Plan = { tier: Tier; name: string; summary: string; features: string[] };

// Marketing copy, not entitlements: what each plan actually gets is decided
// per request by chat-tier-config and the feature flags, server-side.
const PLANS: Plan[] = [
  {
    tier: 'free',
    name: 'Free',
    summary: 'Quick questions, answered fast.',
    features: ['Qwen 4B', 'Short conversations', 'Web search'],
  },
  {
    tier: 'pro',
    name: 'Pro',
    summary: 'For longer threads that build on themselves.',
    features: ['Everything in Free', 'Qwen 4B · long context', 'Conversation memory', 'Unlimited messages'],
  },
  {
    tier: 'enterprise',
    name: 'Enterprise',
    summary: 'The largest models, for code and hard problems.',
    features: ['Everything in Pro', 'Qwen Coder 30B', 'Qwen 3.8 27B'],
  },
];

/**
 * The landing page's "Compare plans" block, released behind
 * `show-plan-comparison`, the flag the targeting demo is built on: an
 * individual target, a `tier` rule and a percentage rollout each decide it
 * for a different audience. The flag must exist in your own LaunchDarkly
 * environment, available to client-side SDKs — see "Re-create the
 * LaunchDarkly flags" in the README.
 *
 * `initialVisible` is the server's evaluation for a logged-in user, so the
 * first paint is already right. Logged-out visitors have no server value:
 * their context key is generated in the browser, so only the client SDK can
 * evaluate their rollout bucket, and the block stays hidden until it has.
 * Off is the default while the flag is missing, as for any unreleased
 * component.
 */
export default function PlanComparison({
  initialVisible,
  currentTier,
}: {
  initialVisible?: boolean;
  currentTier?: Tier;
}) {
  const flags = useFlags();
  const live: unknown = flags['show-plan-comparison'];
  const visible = live === undefined ? (initialVisible ?? false) : live === true;

  if (!visible) return null;

  return (
    <section id="plans" className="mt-16 flex w-full max-w-4xl flex-col gap-6">
      <h2 className="text-center text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
        Compare plans
      </h2>
      <div className="grid gap-4 sm:grid-cols-3">
        {PLANS.map((plan) => {
          const current = plan.tier === currentTier;
          return (
            <div
              key={plan.tier}
              className={`flex flex-col gap-3 rounded-2xl border bg-white p-6 dark:bg-zinc-950 ${
                current
                  ? 'border-black dark:border-zinc-50'
                  : 'border-black/[.08] dark:border-white/[.145]'
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-black dark:text-zinc-50">{plan.name}</h3>
                {current && (
                  <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                    Your plan
                  </span>
                )}
              </div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{plan.summary}</p>
              <ul className="flex flex-col gap-1.5 text-sm text-zinc-700 dark:text-zinc-300">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <span aria-hidden className="text-zinc-400">
                      ✓
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
