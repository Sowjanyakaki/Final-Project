import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import type { ModelMessage } from 'ai';
import { getOrCreateSession } from '../../../lib/agent/session';
import { createAgent } from '../../../lib/agent/orchestrator';
import { getConversationHistory, appendMessage } from '../../../lib/agent/messages';

export const SESSION_COOKIE_NAME = 'nextleap_session';
const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const FALLBACK_REPLY = "Sorry, I had trouble processing that — could you rephrase or try again?";

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

  // streamText has no memory of its own between HTTP requests — without
  // replaying prior turns, every message looked like the start of a brand
  // new conversation to the model, so it could ask a question and then
  // have no idea what the user's reply was answering.
  const history = await getConversationHistory(sessionId);
  const messages: ModelMessage[] = [...history, { role: 'user', content: message }];
  await appendMessage(sessionId, 'user', message);

  const agent = createAgent(sessionId);
  const result = agent.stream(messages, {
    onFinish: async ({ text }) => {
      await appendMessage(sessionId, 'assistant', text);
    },
  });

  // VoiceBar only ever awaits res.text() — it doesn't consume the response
  // incrementally — so there's no streaming UX to preserve here, and
  // buffering server-side lets us catch a failed generation (a real,
  // observed Groq failure: "Failed to call a function...") and return a
  // clear message instead of an empty 200 that looks like the agent went
  // silent.
  let replyText: string;
  try {
    replyText = await result.text;
  } catch {
    replyText = FALLBACK_REPLY;
  }

  const response = new NextResponse(replyText, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });

  cookieStore.set(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });

  return response;
}
