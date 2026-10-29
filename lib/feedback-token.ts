import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * A reply's 👍 / 👎 arrives in a later request, so the browser holds on to
 * the AI SDK's resumption token for that reply: it names the AI Config run,
 * variation and version that produced it, and `aiClient.createTracker(token)`
 * turns it back into that run's tracker. Feedback then lands on the variation
 * that actually wrote the reply, even if the config has changed since.
 *
 * The token itself is not secret, only base64, so a browser could rewrite it
 * to credit its feedback to the other experiment arm. Each token is signed
 * with AUTH_SECRET and bound to the account it was issued to; anything else
 * is refused. Without AUTH_SECRET no token is issued and feedback is off.
 */

function mac(token: string, userId: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(`${userId}\n${token}`).digest();
}

export function signFeedbackToken(token: string, userId: string): string | undefined {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return undefined;
  return `${token}.${mac(token, userId, secret).toString('base64url')}`;
}

/** The original resumption token, or undefined if this account didn't receive it. */
export function verifyFeedbackToken(signed: unknown, userId: string): string | undefined {
  const secret = process.env.AUTH_SECRET;
  if (!secret || typeof signed !== 'string') return undefined;
  // Resumption tokens are base64url, which never contains a dot.
  const split = signed.lastIndexOf('.');
  if (split <= 0) return undefined;
  const token = signed.slice(0, split);
  const given = Buffer.from(signed.slice(split + 1), 'base64url');
  const expected = mac(token, userId, secret);
  return given.length === expected.length && timingSafeEqual(given, expected) ? token : undefined;
}
