import { asc, eq } from 'drizzle-orm';
import type { ModelMessage } from 'ai';
import { db } from '../db/client';
import { messages } from '../db/schema';

/**
 * Loads a session's prior conversation turns so /api/agent can send them
 * back to the model on every request. streamText has no memory of its own
 * between HTTP requests — without this, each turn looked like the first
 * turn of a brand-new conversation to the model.
 */
export async function getConversationHistory(sessionId: string): Promise<ModelMessage[]> {
  const rows = (await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.createdAt))) as Array<{ role: 'user' | 'assistant'; content: string }>;

  return rows.map((row) => ({ role: row.role, content: row.content }));
}

export async function appendMessage(sessionId: string, role: 'user' | 'assistant', content: string): Promise<void> {
  if (!content) return;
  await db.insert(messages).values({ sessionId, role, content, createdAt: new Date() });
}
