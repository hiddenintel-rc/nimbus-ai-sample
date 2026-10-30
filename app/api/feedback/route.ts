import { NextResponse } from 'next/server';
import { LDFeedbackKind } from '@launchdarkly/server-sdk-ai';
import { auth } from '@/lib/auth';
import { verifyFeedbackToken } from '@/lib/feedback-token';
import { buildUserContext, getAiClient, getLDClient } from '@/lib/ld-server';

/**
 * Records a 👍 / 👎 on one assistant reply as AI Config feedback
 * (`$ld:ai:feedback:user:positive` / `negative`). The reply's signed
 * resumption token rebuilds the tracker of the run that wrote it, so the
 * feedback is credited to that run's AI Config and variation. The event
 * itself carries no model name, so feedback is per model only where the
 * model has its own config (see aiConfigForModel). The context still comes
 * from the session, never from the token or the request.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'You must be logged in.' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const kind =
    body?.kind === 'positive'
      ? LDFeedbackKind.Positive
      : body?.kind === 'negative'
        ? LDFeedbackKind.Negative
        : undefined;
  const token = verifyFeedbackToken(body?.token, session.user.id);
  if (!kind || !token) {
    return NextResponse.json({ error: 'A valid reply token and kind are required.' }, { status: 400 });
  }

  try {
    const aiClient = await getAiClient();
    aiClient.createTracker(token, buildUserContext(session.user)).trackFeedback({ kind });
    await (await getLDClient()).flush();
  } catch (error) {
    console.error('[api/feedback]', error);
    return NextResponse.json({ error: 'Feedback could not be recorded.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
