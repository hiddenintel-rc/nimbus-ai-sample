import bcrypt from 'bcryptjs';

export type Tier = 'free' | 'pro' | 'enterprise';

export type DemoUser = {
  id: string;
  email: string;
  passwordHash: string;
  tier: Tier;
  /** Second context attribute, alongside tier, for rule-based targeting. */
  accountAgeDays: number;
};

// Public demo credentials, intentionally published in the README — there is
// no real user data behind this app. Every demo account shares one password.
const DEMO_PASSWORD_HASH = bcrypt.hashSync('nimbus-demo', 10);

export const demoUsers: DemoUser[] = [
  {
    id: 'demo-free',
    email: 'demo-free@nimbus.app',
    passwordHash: DEMO_PASSWORD_HASH,
    tier: 'free',
    accountAgeDays: 12,
  },
  {
    id: 'demo-pro',
    email: 'demo-pro@nimbus.app',
    passwordHash: DEMO_PASSWORD_HASH,
    tier: 'pro',
    accountAgeDays: 420,
  },
  {
    id: 'demo-enterprise',
    email: 'demo-enterprise@nimbus.app',
    passwordHash: DEMO_PASSWORD_HASH,
    tier: 'enterprise',
    accountAgeDays: 1100,
  },
];

export function findDemoUser(email: string): DemoUser | undefined {
  return demoUsers.find((user) => user.email.toLowerCase() === email.toLowerCase());
}
