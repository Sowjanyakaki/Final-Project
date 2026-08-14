import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db } from '../../../lib/db/client';
import { shortlistItems } from '../../../lib/db/schema';
import { getOrCreateSession } from '../../../lib/agent/session';
import { searchListings } from '../../../lib/agent/tools/searchListings';
import { retrieveNeighborhoodDocs } from '../../../lib/agent/tools/retrieveNeighborhoodDocs';
import { osmNearby, type OsmNearbyResult } from '../../../lib/agent/tools/osmNearby';
import { SESSION_COOKIE_NAME } from '../agent/route';
import type { Citation, NeighborhoodSnapshot, ShortlistApiItem } from '../../../lib/types';

const SHORTLIST_LIMIT = 6;
const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * Session-aware, filterable shortlist feed for the companion UI. Seeds any
 * newly-returned listing as an `active` shortlistItems row for the session
 * (so POST /api/shortlist/remove has something to mutate) and excludes any
 * listing already marked `dropped` for this session, even if it still
 * matches the current search/filter — a heart-removed card stays removed
 * until the session ends.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const locality = searchParams.get('locality') ?? undefined;
  const bedroomsParam = searchParams.get('bedrooms');
  const bedrooms = bedroomsParam !== null && bedroomsParam !== '' ? Number(bedroomsParam) : undefined;

  const cookieStore = await cookies();
  const { id: sessionId } = await getOrCreateSession(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  const results = await searchListings({
    locality,
    bedrooms: bedrooms !== undefined && !Number.isNaN(bedrooms) ? bedrooms : undefined,
  });

  const existingRows = (await db
    .select({ listingId: shortlistItems.listingId, status: shortlistItems.status })
    .from(shortlistItems)
    .where(eq(shortlistItems.sessionId, sessionId))) as Array<{ listingId: number; status: 'active' | 'dropped' }>;

  const existingIds = new Set(existingRows.map((r) => r.listingId));
  const droppedIds = new Set(existingRows.filter((r) => r.status === 'dropped').map((r) => r.listingId));

  const toSeed = results.filter((listing) => !existingIds.has(listing.id));
  if (toSeed.length > 0) {
    await db.insert(shortlistItems).values(
      toSeed.map((listing) => ({
        sessionId,
        listingId: listing.id,
        status: 'active' as const,
        reason: 'Shown in Explore results',
        addedAt: new Date(),
      }))
    );
  }

  const visible = results.filter((listing) => !droppedIds.has(listing.id));

  // Prefer listings whose locality we could resolve, so the neighborhood
  // panel has real grounded content to show in the demo.
  const withLocality = visible.filter((r) => r.locality);
  const withoutLocality = visible.filter((r) => !r.locality);
  const top = [...withLocality, ...withoutLocality].slice(0, SHORTLIST_LIMIT);

  const items: ShortlistApiItem[] = await Promise.all(
    top.map(async (listing) => {
      const hasCoordinates = listing.lat !== null && listing.lng !== null;

      const [safety, transit, amenities] = await Promise.all([
        listing.locality
          ? retrieveNeighborhoodDocs({ locality: listing.locality, topic: 'safety and neighborhood character' })
          : Promise.resolve({ chunks: [], uncertain: true }),
        hasCoordinates
          ? osmNearby({ lat: listing.lat as number, lng: listing.lng as number, category: 'transit' })
          : Promise.resolve<OsmNearbyResult>({ items: [], uncertain: true }),
        hasCoordinates
          ? osmNearby({ lat: listing.lat as number, lng: listing.lng as number, category: 'amenities' })
          : Promise.resolve<OsmNearbyResult>({ items: [], uncertain: true }),
      ]);

      const describeOsmItem = (item: OsmNearbyResult['items'][number]) =>
        `${item.name} (${item.type})${item.distanceMeters !== undefined ? ` — ${Math.round(item.distanceMeters)}m` : ''}`;

      const neighborhoodSnapshot: NeighborhoodSnapshot = {
        transit: transit.items.map((item) => ({ text: describeOsmItem(item), source: 'OpenStreetMap' })),
        safety: safety.chunks.map((chunk) => ({
          text: `${chunk.chunkText.slice(0, 240)}…`,
          source: chunk.sourceTitle,
        })),
        amenities: amenities.items.map((item) => ({ text: describeOsmItem(item), source: 'OpenStreetMap' })),
        uncertain: {
          transit: transit.uncertain,
          safety: safety.uncertain,
          amenities: amenities.uncertain,
        },
      };

      const citations: Citation[] = [
        ...safety.chunks.map((chunk) => ({ label: chunk.sourceTitle, url: chunk.sourceUrl, kind: 'rag' as const })),
        ...(transit.items.length > 0
          ? [{ label: 'OSM: find_nearby_places(transit)', kind: 'osm' as const }]
          : []),
        ...(amenities.items.length > 0
          ? [{ label: 'OSM: find_nearby_places(amenity)', kind: 'osm' as const }]
          : []),
      ];

      return {
        listing: {
          id: String(listing.id),
          societyName: listing.societyName ?? 'Unnamed listing',
          locality: listing.locality ?? 'Unknown locality',
          rent: listing.rent ?? 0,
          bedrooms: listing.bedrooms ?? 0,
          furnishing: listing.furnishing ?? 'Unknown',
          amenities: listing.amenities,
          sqft: listing.sqft ?? 0,
          availabilityStatus: listing.availabilityStatus,
          scrapedAt: listing.scrapedAt.toISOString(),
        },
        neighborhoodSnapshot,
        citations,
      };
    })
  );

  const response = NextResponse.json({ sessionId, items });
  cookieStore.set(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}
