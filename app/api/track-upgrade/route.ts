import { NextResponse } from 'next/server';
import { getLDClient, buildUserContext } from '@/lib/ld-server';
import { auth } from '@/lib/auth';

/**
 * Fires the `clicked-upgrade` conversion metric used by the chat-tier-config
 * experiment. No real purchase happens here — this only records intent.
 * The metric itself (event key "clicked-upgrade") must exist in your own
 * LaunchDarkly environment — see "Re-create the LaunchDarkly flags" in the
 * README. Without it, this still runs fine; the event just won't be tied
 * to a metric on LaunchDarkly's side.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'You must be logged in.' }, { status: 401 });
  }

  const client = await getLDClient();
  const context = buildUserContext(session.user);

  client.track('clicked-upgrade', context);
  await client.flush();

  return NextResponse.json({ ok: true });
}
