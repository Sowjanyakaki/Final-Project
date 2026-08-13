import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '../../../lib/db/client';
import { shortlistItems, listings } from '../../../lib/db/schema';

const WEBHOOK_TIMEOUT_MS = 10_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  let body: { sessionId?: unknown; email?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { sessionId, email } = body;

  if (typeof sessionId !== 'string' || sessionId.trim() === '') {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }
  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
  }

  const rows = await db
    .select({
      societyName: listings.societyName,
      locality: listings.locality,
      rent: listings.rent,
      bedrooms: listings.bedrooms,
      amenities: listings.amenities,
      sqft: listings.sqft,
    })
    .from(shortlistItems)
    .innerJoin(listings, eq(shortlistItems.listingId, listings.id))
    .where(and(eq(shortlistItems.sessionId, sessionId), eq(shortlistItems.status, 'active')));

  if (rows.length === 0) {
    return NextResponse.json({ error: 'No active shortlist items to send for this session' }, { status: 400 });
  }

  const webhookUrl = process.env.N8N_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json({ error: 'Notification service is not configured' }, { status: 500 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  let webhookResponse: Response;
  try {
    webhookResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, shortlist: rows, email }),
      signal: controller.signal,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to reach the notification workflow' }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }

  if (!webhookResponse.ok) {
    return NextResponse.json(
      { error: `Notification workflow rejected the request (status ${webhookResponse.status})` },
      { status: 502 }
    );
  }

  return NextResponse.json({ status: 'sent' });
}
