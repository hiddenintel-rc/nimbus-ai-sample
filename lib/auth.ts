import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { findDemoUser, verifyDemoPassword, type Tier } from '@/lib/demo-users';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      tier: Tier;
      accountAgeDays: number;
    };
  }
}

type ExtraClaims = { tier: Tier; accountAgeDays: number };

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = typeof credentials?.email === 'string' ? credentials.email : '';
        const password = typeof credentials?.password === 'string' ? credentials.password : '';

        const user = findDemoUser(email);
        if (!user) return null;

        const passwordMatches = await verifyDemoPassword(password);
        if (!passwordMatches) return null;

        return {
          id: user.id,
          email: user.email,
          tier: user.tier,
          accountAgeDays: user.accountAgeDays,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const claims = token as unknown as ExtraClaims;
        claims.tier = (user as { tier: Tier }).tier;
        claims.accountAgeDays = (user as { accountAgeDays: number }).accountAgeDays;
      }
      return token;
    },
    async session({ session, token }) {
      const claims = token as unknown as ExtraClaims;
      session.user.id = token.sub ?? '';
      session.user.tier = claims.tier ?? 'free';
      session.user.accountAgeDays = claims.accountAgeDays ?? 0;
      return session;
    },
  },
});
