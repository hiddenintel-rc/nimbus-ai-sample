/**
 * Generates synthetic free-tier traffic against `chat-tier-config` so the
 * experiment on its Default rule (Free Tier vs. Pro Tier, among tier=="free"
 * contexts) has enough sample size for LaunchDarkly's results page to show a
 * real readout. This app has no production audience, so this is a
 * documented stand-in for it — not an attempt to fabricate a conclusion.
 *
 * Each simulated "session" is a distinct context (so it can be randomly
 * bucketed into either arm) that evaluates the flag once, then probabilistically
 * fires the clicked-upgrade conversion metric. The conversion rates below are
 * made up for demo purposes, deliberately higher for the Pro arm, to produce
 * a readable effect — real traffic would just be whatever it is.
 *
 * Usage: npm run simulate:experiment [session count, default 300]
 */
import fs from 'node:fs';
import path from 'node:path';
import { init, type LDContext } from '@launchdarkly/node-server-sdk';

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvLocal();

const SDK_KEY = process.env.LAUNCHDARKLY_SDK_KEY;
if (!SDK_KEY) {
  console.error('LAUNCHDARKLY_SDK_KEY is not set — check .env.local.');
  process.exit(1);
}

const SESSION_COUNT = Number(process.argv[2] ?? 300);

// Synthetic, documented-as-such conversion propensities per experiment arm.
const CONVERSION_RATE: Record<string, number> = { free: 0.04, pro: 0.11 };

function makeContext(index: number): LDContext {
  return {
    kind: 'user',
    key: `sim-free-user-${index}`,
    email: `sim-free-user-${index}@example.com`,
    tier: 'free',
    accountAgeDays: Math.floor(Math.random() * 60),
  };
}

async function main() {
  const client = init(SDK_KEY!);
  await client.waitForInitialization({ timeout: 10 });

  const counts: Record<string, number> = { free: 0, pro: 0 };
  let conversions = 0;

  for (let i = 0; i < SESSION_COUNT; i++) {
    const context = makeContext(i);

    const tierConfig = (await client.variation('chat-tier-config', context, {
      label: 'Free',
    })) as { label?: string };
    const label = (tierConfig.label ?? 'Free').toLowerCase();

    counts[label] = (counts[label] ?? 0) + 1;

    const rate = CONVERSION_RATE[label] ?? CONVERSION_RATE.free;
    if (Math.random() < rate) {
      client.track('clicked-upgrade', context);
      conversions++;
    }
  }

  await client.flush();

  console.log(`Simulated ${SESSION_COUNT} synthetic free-tier sessions.`);
  console.log(`  served Free Tier config: ${counts.free ?? 0}`);
  console.log(`  served Pro Tier config:  ${counts.pro ?? 0}`);
  console.log(`  clicked-upgrade conversions: ${conversions}`);

  client.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
