import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '../../../lib/db/client';
import { shortlistItems, listings } from '../../../lib/db/schema';

const WEBHOOK_TIMEOUT_MS = 10_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// This route has no auth layer (per ARCHITECTURE.md, sessions are
// cookie-keyed but not login-gated) and lets the caller name an arbitrary
// destination `email`. Without a limiter, anyone holding (or guessing) a
// live sessionId could hammer this endpoint to spam arbitrary third-party
// addresses through our n8n webhook — an open mail-relay pattern. Cap both
// the rate and the daily volume per session as a lightweight mitigation.
const RATE_LIMIT_COOLDOWN_MS = 60_000;
const MAX_SENDS_PER_SESSION_PER_DAY = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

type RateLimitEntry = { lastSentAt: number; sentTimestamps: number[] };
const rateLimitBySession = new Map<string, RateLimitEntry>();

function checkRateLimit(sessionId: string): { allowed: boolean; retryAfterSeconds?: number } {
  const now = Date.now();
  const entry = rateLimitBySession.get(sessionId);

  if (!entry) {
    rateLimitBySession.set(sessionId, { lastSentAt: now, sentTimestamps: [now] });
    return { allowed: true };
  }

  const sinceLastSend = now - entry.lastSentAt;
  if (sinceLastSend < RATE_LIMIT_COOLDOWN_MS) {
    return { allowed: false, retryAfterSeconds: Math.ceil((RATE_LIMIT_COOLDOWN_MS - sinceLastSend) / 1000) };
  }

  const sentToday = entry.sentTimestamps.filter((t) => now - t < DAY_MS);
  if (sentToday.length >= MAX_SENDS_PER_SESSION_PER_DAY) {
    return { allowed: false };
  }

  sentToday.push(now);
  entry.lastSentAt = now;
  entry.sentTimestamps = sentToday;
  return { allowed: true };
}

/** Test-only: clears in-memory rate-limit state between test cases. */
export function __resetNotifyRateLimitForTests(): void {
  rateLimitBySession.clear();
}

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

  const rateLimit = checkRateLimit(sessionId);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many notification requests for this session. Please try again later.' },
      { status: 429, headers: rateLimit.retryAfterSeconds ? { 'Retry-After': String(rateLimit.retryAfterSeconds) } : {} }
    );
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
