import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { applyShortlistEdit } from '../../../../lib/agent/tools/applyShortlistEdit';
import { SESSION_COOKIE_NAME } from '../../agent/route';

export async function POST(request: Request) {
  let body: { listingId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { listingId } = body;
  if (typeof listingId !== 'number' || !Number.isFinite(listingId)) {
    return NextResponse.json({ error: 'listingId is required' }, { status: 400 });
  }

  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionId) {
    return NextResponse.json({ error: 'No active shortlist session' }, { status: 400 });
  }

  const diff = await applyShortlistEdit({ sessionId, editIntent: { op: 'remove', listingId } });

  return NextResponse.json(diff);
}
