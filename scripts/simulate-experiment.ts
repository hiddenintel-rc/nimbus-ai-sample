/**
 * Generates synthetic free-tier traffic against `show-plan-comparison` so the
 * experiment on its free-tier rule (control: no "Compare plans" block,
 * treatment: block shown, among tier == "free" contexts) has enough sample
 * size for LaunchDarkly's results page to show a real readout. This app has
 * no production audience, so this is a documented stand-in for it — not an
 * attempt to fabricate a conclusion.
 *
 * Each simulated "session" is a distinct context (so it can be randomly
 * bucketed into either arm) that evaluates the flag once, then
 * probabilistically fires the clicked-upgrade conversion metric, at most once.
 * The conversion rates below are made up for demo purposes, deliberately
 * higher when the block is shown, to produce a readable effect — real traffic
 * would just be whatever it is.
 *
 * The earlier experiment on chat-tier-config (Free Tier vs Pro Tier) used a
 * previous version of this script; see git history and "Experiment result
 * and decision" in docs/ARCHITECTURE.md.
 *
 * Usage: npm run simulate:experiment [session count, default 4000]
 */
import { init, type LDContext } from '@launchdarkly/node-server-sdk';
import { loadEnvLocal } from './load-env';

loadEnvLocal();

const SDK_KEY = process.env.LAUNCHDARKLY_SDK_KEY;
if (!SDK_KEY) {
  console.error('LAUNCHDARKLY_SDK_KEY is not set — check .env.local.');
  process.exit(1);
}

const SESSION_COUNT = Number(process.argv[2] ?? 4000);

// Flushed every this many sessions. Each session queues an index event, a
// feature event and sometimes a custom event; the SDK drops events beyond its
// buffer (10,000 by default) until the next flush.
const FLUSH_EVERY = 500;

// Synthetic, documented-as-such conversion propensities per experiment arm.
const CONVERSION_RATE = { hidden: 0.04, shown: 0.07 };

function makeContext(index: number): LDContext {
  return {
    kind: 'user',
    key: `sim-plans-free-user-${index}`,
    email: `sim-plans-free-user-${index}@example.com`,
    tier: 'free',
    accountAgeDays: Math.floor(Math.random() * 60),
  };
}

async function main() {
  const client = init(SDK_KEY!);
  await client.waitForInitialization({ timeout: 10 });

  const counts = { shown: 0, hidden: 0 };
  const conversions = { shown: 0, hidden: 0 };
  let inExperiment = 0;

  for (let i = 0; i < SESSION_COUNT; i++) {
    const context = makeContext(i);

    const detail = await client.variationDetail('show-plan-comparison', context, false);
    if (detail.reason.inExperiment) inExperiment++;
    const arm = detail.value === true ? 'shown' : 'hidden';
    counts[arm]++;

    if (Math.random() < CONVERSION_RATE[arm]) {
      client.track('clicked-upgrade', context);
      conversions[arm]++;
    }

    if ((i + 1) % FLUSH_EVERY === 0) await client.flush();
  }

  await client.flush();

  console.log(`Simulated ${SESSION_COUNT} synthetic free-tier sessions.`);
  console.log(`  in the experiment:          ${inExperiment}`);
  console.log(`  shown Compare plans:        ${counts.shown} (${conversions.shown} clicked Upgrade)`);
  console.log(`  not shown Compare plans:    ${counts.hidden} (${conversions.hidden} clicked Upgrade)`);
  if (inExperiment === 0) {
    console.log('  No session entered an experiment — is it started on the free-tier rule?');
  }

  client.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
