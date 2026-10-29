import bcrypt from 'bcryptjs';

export type Tier = 'free' | 'pro' | 'enterprise';

export type DemoUser = {
  id: string;
  email: string;
  tier: Tier;
  /** Second targetable attribute alongside tier. Sent to LaunchDarkly; no rule uses it. */
  accountAgeDays: number;
};

// Every demo account shares one password, read from DEMO_PASSWORD in
// .env.local. It is never committed, so only people given the password can
// use the chat and the model backend behind it.
let demoPasswordHash: string | null | undefined;

function getDemoPasswordHash(): string | null {
  if (demoPasswordHash === undefined) {
    const password = process.env.DEMO_PASSWORD;
    if (!password) {
      console.error(
        '[auth] DEMO_PASSWORD is not set — demo logins are disabled. ' +
          'Copy .env.example to .env.local and fill it in.',
      );
    }
    demoPasswordHash = password ? bcrypt.hashSync(password, 10) : null;
  }
  return demoPasswordHash;
}

/** False for every password when DEMO_PASSWORD isn't configured. */
export async function verifyDemoPassword(password: string): Promise<boolean> {
  const hash = getDemoPasswordHash();
  return hash ? bcrypt.compare(password, hash) : false;
}

export const demoUsers: DemoUser[] = [
  {
    id: 'demo-free',
    email: 'demo-free@nimbus.app',
    tier: 'free',
    accountAgeDays: 12,
  },
  {
    id: 'demo-pro',
    email: 'demo-pro@nimbus.app',
    tier: 'pro',
    accountAgeDays: 420,
  },
  {
    id: 'demo-enterprise',
    email: 'demo-enterprise@nimbus.app',
    tier: 'enterprise',
    accountAgeDays: 1100,
  },
];

export function findDemoUser(email: string): DemoUser | undefined {
  return demoUsers.find((user) => user.email.toLowerCase() === email.toLowerCase());
}
