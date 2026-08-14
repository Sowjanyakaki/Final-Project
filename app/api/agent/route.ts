import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import type { ModelMessage } from 'ai';
import { getOrCreateSession } from '../../../lib/agent/session';
import { createAgent } from '../../../lib/agent/orchestrator';

export const SESSION_COOKIE_NAME = 'nextleap_session';
const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * Wraps the orchestrator as a real route: VoiceBar posts { message } and
 * awaits the full text reply via res.text() (see components/VoiceBar.tsx),
 * so a streamed text response satisfies that contract without changing it.
 */
export async function POST(request: Request) {
  let body: { message?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { message } = body;
  if (typeof message !== 'string' || message.trim() === '') {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }

  const cookieStore = await cookies();
  const { id: sessionId } = await getOrCreateSession(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  const messages: ModelMessage[] = [{ role: 'user', content: message }];
  const agent = createAgent(sessionId);
  const result = agent.stream(messages);
  const response = result.toTextStreamResponse();

  cookieStore.set(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });

  return response;
}
