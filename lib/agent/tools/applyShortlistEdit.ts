import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { shortlistItems, listings, toolCallLog } from '../../db/schema';
import { searchListings, type ListingConstraints } from './searchListings';

export type EditIntent =
  | { op: 'filter'; field: 'rent' | 'bedrooms'; comparator: '<=' | '>=' | '<' | '>'; value: number }
  | { op: 'add'; filters: Partial<ListingConstraints> }
  | { op: 'remove'; listingId: number };

export type ShortlistDiff = { changed: number[]; unchanged: number[] };

function passesComparator(actual: number, comparator: '<=' | '>=' | '<' | '>', value: number): boolean {
  switch (comparator) {
    case '<=':
      return actual <= value;
    case '>=':
      return actual >= value;
    case '<':
      return actual < value;
    case '>':
      return actual > value;
  }
}

async function applyFilter(
  sessionId: string,
  editIntent: Extract<EditIntent, { op: 'filter' }>
): Promise<ShortlistDiff> {
  const rows = (await db
    .select({
      shortlistItemId: shortlistItems.id,
      listingId: shortlistItems.listingId,
      rent: listings.rent,
      bedrooms: listings.bedrooms,
    })
    .from(shortlistItems)
    .innerJoin(listings, eq(shortlistItems.listingId, listings.id))
    .where(and(eq(shortlistItems.sessionId, sessionId), eq(shortlistItems.status, 'active')))) as Array<{
    shortlistItemId: number;
    listingId: number;
    rent: number;
    bedrooms: number;
  }>;

  const changed: number[] = [];
  const unchanged: number[] = [];

  for (const row of rows) {
    const actual = editIntent.field === 'rent' ? row.rent : row.bedrooms;
    const keeps = passesComparator(actual, editIntent.comparator, editIntent.value);
    if (keeps) {
      unchanged.push(row.listingId);
      continue;
    }
    changed.push(row.listingId);
    await db
      .update(shortlistItems)
      .set({
        status: 'dropped',
        reason: `Dropped: ${editIntent.field} ${editIntent.comparator} ${editIntent.value} not satisfied`,
      })
      .where(eq(shortlistItems.id, row.shortlistItemId));
  }

  return { changed, unchanged };
}

async function applyRemove(sessionId: string, listingId: number): Promise<ShortlistDiff> {
  const rows = (await db
    .select({ shortlistItemId: shortlistItems.id, listingId: shortlistItems.listingId })
    .from(shortlistItems)
    .where(and(eq(shortlistItems.sessionId, sessionId), eq(shortlistItems.status, 'active')))) as Array<{
    shortlistItemId: number;
    listingId: number;
  }>;

  const changed: number[] = [];
  const unchanged: number[] = [];

  for (const row of rows) {
    if (row.listingId === listingId) {
      changed.push(row.listingId);
      await db
        .update(shortlistItems)
        .set({ status: 'dropped', reason: 'Removed by user request' })
        .where(eq(shortlistItems.id, row.shortlistItemId));
    } else {
      unchanged.push(row.listingId);
    }
  }

  return { changed, unchanged };
}

async function applyAdd(sessionId: string, filters: Partial<ListingConstraints>): Promise<ShortlistDiff> {
  const existingRows = (await db
    .select({ listingId: shortlistItems.listingId })
    .from(shortlistItems)
    .where(and(eq(shortlistItems.sessionId, sessionId), eq(shortlistItems.status, 'active')))) as Array<{
    listingId: number;
  }>;

  const existingIds = new Set(existingRows.map((r) => r.listingId));
  const unchanged = [...existingIds];

  const results = await searchListings(filters as ListingConstraints);
  const changed: number[] = [];

  for (const listing of results) {
    if (existingIds.has(listing.id)) continue;
    await db.insert(shortlistItems).values({
      sessionId,
      listingId: listing.id,
      status: 'active',
      reason: 'Added to match new filter',
      addedAt: new Date(),
    });
    changed.push(listing.id);
  }

  return { changed, unchanged };
}

/**
 * Applies a structured, scoped edit against ONLY the session's current
 * active shortlist rows. Never regenerates the shortlist from scratch — this
 * is what makes the Edit Correctness Eval possible (unaffected rows are
 * never written to). Every call is logged to toolCallLog.
 */
export async function applyShortlistEdit(input: {
  sessionId: string;
  editIntent: EditIntent;
}): Promise<ShortlistDiff> {
  const { sessionId, editIntent } = input;

  let diff: ShortlistDiff;
  if (editIntent.op === 'filter') {
    diff = await applyFilter(sessionId, editIntent);
  } else if (editIntent.op === 'remove') {
    diff = await applyRemove(sessionId, editIntent.listingId);
  } else {
    diff = await applyAdd(sessionId, editIntent.filters);
  }

  await db.insert(toolCallLog).values({
    sessionId,
    toolName: 'applyShortlistEdit',
    input: editIntent,
    output: diff,
    createdAt: new Date(),
  });

  return diff;
}
