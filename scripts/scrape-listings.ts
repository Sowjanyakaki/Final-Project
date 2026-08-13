import { db } from '../lib/db/client';
import { listings } from '../lib/db/schema';
import { stripPII } from '../lib/pii/stripPII';
import type { CleanListing, RawScrapedListing } from '../lib/pii/stripPII';
import { nearestLocality } from '../lib/geo/nearestLocality';

/**
 * bengaluru.rent's own frontend loads pins from this public, unauthenticated
 * Supabase Edge Function (confirmed by inspecting the live site's network
 * traffic) — no browser/JS rendering is actually needed to get the same data
 * the map shows.
 */
const GET_PINS_URL = 'https://mpnjtkqklmwczowhodfh.supabase.co/functions/v1/get-pins';

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function parseBhk(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d+)/);
  return match ? Number(match[1]) : null;
}

/** Builds a factual amenity-tag list from the real boolean/enum fields bengaluru.rent exposes — nothing invented. */
function buildAmenities(pin: Record<string, unknown>): string[] {
  const tags: string[] = [];
  if (pin.gated === true) tags.push('gated community');
  if (pin.maintenance_included === true) tags.push('maintenance included');
  if (pin.pet_friendly === 'yes') tags.push('pet friendly');
  if (typeof pin.deposit_months === 'string' || typeof pin.deposit_months === 'number') {
    tags.push(`${pin.deposit_months} month(s) deposit`);
  }
  if (pin.occupant_type === 'family') tags.push('family friendly');
  if (pin.available_from === 'asap') tags.push('available immediately');
  if (pin.available_from === 'next_month') tags.push('available next month');
  return tags;
}

/**
 * Maps one raw pin object from GET_PINS_URL into a RawScrapedListing, or
 * returns null when the pin should be excluded from the working set.
 *
 * Pure function: no network, no DB — fully unit-testable.
 *
 * Returns null when:
 *  - rawPinData isn't a usable object, OR
 *  - pin_kind isn't 'rent' (excludes "Spot a To-Let" board pins, a
 *    different pin category with almost no listing fields), OR
 *  - listing_type is null — this is bengaluru.rent's "Not for rent" case:
 *    a pin dropped purely for rent-transparency, not an active listing
 *    (confirmed against the live site: only listing_type 'whole_flat' or
 *    'room' pins render the "AVBL" badge on the map), OR
 *  - is_suspicious is true — flagged unreliable by the source itself, OR
 *  - there's no usable id to build a stable sourceUrl from.
 */
export function parsePin(rawPinData: unknown): RawScrapedListing | null {
  if (typeof rawPinData !== 'object' || rawPinData === null) {
    return null;
  }
  const pin = rawPinData as Record<string, unknown>;

  if (pin.pin_kind !== 'rent') return null;
  if (!pin.listing_type) return null;
  if (pin.is_suspicious === true) return null;

  const id = toStringOrNull(pin.id);
  if (!id) return null;

  const lat = toNumberOrNull(pin.lat);
  const lng = toNumberOrNull(pin.lng);

  return {
    sourceUrl: `https://bengaluru.rent/?pin=${id}`,
    societyName: toStringOrNull(pin.society),
    locality: nearestLocality(lat, lng),
    lat,
    lng,
    rent: toNumberOrNull(pin.rent_amount),
    bedrooms: parseBhk(pin.bhk),
    furnishing: pin.furnished === true ? 'furnished' : pin.furnished === false ? 'unfurnished' : null,
    amenities: buildAmenities(pin),
    sqft: toNumberOrNull(pin.sqft),
    availabilityStatus: 'available',
  };
}

/**
 * Insert-or-update a listing keyed by sourceUrl. Accepts an optional
 * db-like client so tests can inject a mock instead of hitting SQLite.
 */
export async function upsertListing(
  record: CleanListing,
  dbClient: Pick<typeof db, 'insert'> = db
): Promise<void> {
  const columns = {
    societyName: record.societyName,
    locality: record.locality,
    lat: record.lat,
    lng: record.lng,
    rent: record.rent,
    bedrooms: record.bedrooms,
    furnishing: record.furnishing,
    amenities: record.amenities,
    sqft: record.sqft,
    availabilityStatus: record.availabilityStatus,
    scrapedAt: new Date(),
  };

  await dbClient
    .insert(listings)
    .values({ sourceUrl: record.sourceUrl, ...columns })
    .onConflictDoUpdate({
      target: listings.sourceUrl,
      set: columns,
    });
}

/**
 * Live scrape entry point: fetches every pin bengaluru.rent's map itself
 * loads, filters to currently-available listings, strips PII (defense in
 * depth — the source has none today, but never trust that blindly), and
 * upserts each into `listings`.
 */
async function scrapeAndStore(): Promise<void> {
  const response = await fetch(GET_PINS_URL);
  if (!response.ok) {
    throw new Error(`get-pins request failed: ${response.status} ${response.statusText}`);
  }
  const { pins } = (await response.json()) as { pins: unknown[] };

  let upserted = 0;
  let skipped = 0;
  for (const raw of pins) {
    const parsed = parsePin(raw);
    if (!parsed) {
      skipped++;
      continue;
    }
    const clean = stripPII(parsed);
    await upsertListing(clean);
    upserted++;
  }
  console.log(`[scrape-listings] upserted ${upserted} listings, skipped ${skipped} pins`);
}

// Vitest sets process.env.VITEST during test runs — this keeps `import`ing
// this module for its pure functions from ever hitting the network.
if (!process.env.VITEST) {
  scrapeAndStore().catch((err) => {
    console.error('[scrape-listings] failed:', err);
    process.exit(1);
  });
}
