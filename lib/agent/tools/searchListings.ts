import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { listings } from '../../db/schema';

export type Listing = typeof listings.$inferSelect;

export interface ListingConstraints {
  budgetMax?: number;
  bedrooms?: number;
  locality?: string;
  mustHaves?: string[];
}

/**
 * Deterministic (non-LLM) search over the listings table.
 * Always excludes anything not currently available, applies budget/bedrooms/
 * locality/must-have filters, then ranks by closeness to budget first and
 * must-have match count second.
 */
export async function searchListings(constraints: ListingConstraints): Promise<Listing[]> {
  const conditions = [eq(listings.availabilityStatus, 'available')];
  if (constraints.locality) {
    conditions.push(eq(listings.locality, constraints.locality));
  }
  if (constraints.bedrooms !== undefined) {
    conditions.push(eq(listings.bedrooms, constraints.bedrooms));
  }

  const rows = (await db
    .select()
    .from(listings)
    .where(and(...conditions))) as Listing[];

  const mustHaves = constraints.mustHaves ?? [];

  const filtered = rows.filter((row) => {
    // Defense in depth: never surface a not_for_rent row even if the SQL
    // predicate above changes or the mock/test bypasses it.
    if (row.availabilityStatus !== 'available') return false;
    if (constraints.budgetMax !== undefined && (row.rent ?? Infinity) > constraints.budgetMax) return false;
    const amenities = Array.isArray(row.amenities) ? (row.amenities as string[]) : [];
    return mustHaves.every((mustHave) => amenities.includes(mustHave));
  });

  const scored = filtered.map((row) => {
    const amenities = Array.isArray(row.amenities) ? (row.amenities as string[]) : [];
    const matchCount = mustHaves.filter((m) => amenities.includes(m)).length;
    const budgetDistance =
      constraints.budgetMax !== undefined ? Math.abs((row.rent ?? 0) - constraints.budgetMax) : 0;
    return { row, matchCount, budgetDistance };
  });

  scored.sort((a, b) => {
    if (a.budgetDistance !== b.budgetDistance) return a.budgetDistance - b.budgetDistance;
    return b.matchCount - a.matchCount;
  });

  return scored.map((s) => s.row);
}
