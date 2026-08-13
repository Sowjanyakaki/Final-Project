import { NextResponse } from 'next/server';
import { searchListings } from '../../../lib/agent/tools/searchListings';
import { retrieveNeighborhoodDocs } from '../../../lib/agent/tools/retrieveNeighborhoodDocs';
import type { Citation, NeighborhoodSnapshot, ShortlistApiItem } from '../../../lib/types';

const SHORTLIST_LIMIT = 6;

/**
 * Real (not mocked) shortlist feed for the companion UI: pulls from the
 * actually-scraped `listings` table and grounds the safety section in the
 * actually-ingested Wikipedia chunks via retrieveNeighborhoodDocs.
 *
 * transit/amenities are marked uncertain — OSM_MCP_URL isn't configured yet
 * (docs/ARCHITECTURE.md §8), so this deliberately says "data unavailable"
 * rather than guessing, per the Grounding & Hallucination requirement.
 */
export async function GET() {
  const results = await searchListings({});

  // Prefer listings whose locality we could resolve, so the neighborhood
  // panel has real grounded content to show in the demo.
  const withLocality = results.filter((r) => r.locality);
  const withoutLocality = results.filter((r) => !r.locality);
  const top = [...withLocality, ...withoutLocality].slice(0, SHORTLIST_LIMIT);

  const items: ShortlistApiItem[] = await Promise.all(
    top.map(async (listing) => {
      const safety = listing.locality
        ? await retrieveNeighborhoodDocs({ locality: listing.locality, topic: 'safety and neighborhood character' })
        : { chunks: [], uncertain: true };

      const neighborhoodSnapshot: NeighborhoodSnapshot = {
        transit: [],
        safety: safety.chunks.map((chunk) => ({
          text: `${chunk.chunkText.slice(0, 240)}…`,
          source: chunk.sourceTitle,
        })),
        amenities: [],
        uncertain: {
          transit: true,
          safety: safety.uncertain,
          amenities: true,
        },
      };

      const citations: Citation[] = safety.chunks.map((chunk) => ({
        label: chunk.sourceTitle,
        url: chunk.sourceUrl,
        kind: 'rag',
      }));

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
        },
        neighborhoodSnapshot,
        citations,
      };
    })
  );

  return NextResponse.json(items);
}
