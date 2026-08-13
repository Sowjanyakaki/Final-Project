import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { sessions } from '../db/schema';

/**
 * Gets the session identified by cookieSessionId, or creates a fresh one if
 * no id was given or the given id doesn't match any row (e.g. a stale
 * cookie from a previous deploy/DB reset).
 */
export async function getOrCreateSession(cookieSessionId?: string): Promise<{ id: string; isNew: boolean }> {
  if (cookieSessionId) {
    const existing = (await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.id, cookieSessionId))) as Array<{ id: string }>;

    if (existing.length > 0) {
      return { id: existing[0].id, isNew: false };
    }
  }

  const newId = randomUUID();
  await db.insert(sessions).values({ id: newId, createdAt: new Date(), constraints: {}, status: 'active' });
  return { id: newId, isNew: true };
}
