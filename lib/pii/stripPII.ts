/**
 * Raw shape as scraped off bengaluru.rent map pins, before PII removal.
 * Any owner/agent/contact-style field that might appear on a scraped pin is
 * declared here so parsePin() (scripts/scrape-listings.ts) has somewhere
 * type-safe to put it — but stripPII() below NEVER reads these fields back
 * out. The index signature tolerates any other unexpected raw field without
 * ever leaking it into CleanListing.
 *
 * In practice, bengaluru.rent's public pins feed never carries owner/agent
 * contact info at all (verified against the live get-pins response) — this
 * allowlist stays in place anyway as a defensive boundary in case that
 * changes or another source is added later.
 */
export interface RawScrapedListing {
  sourceUrl: string;
  societyName: string | null;
  locality: string | null;
  lat: number | null;
  lng: number | null;
  rent: number | null;
  bedrooms: number | null;
  furnishing: string | null;
  amenities: string[];
  sqft: number | null;
  availabilityStatus: 'available' | 'not_for_rent';
  ownerName?: string;
  agentName?: string;
  contactName?: string;
  phone?: string;
  phoneNumber?: string;
  whatsapp?: string;
  [extraField: string]: unknown;
}

/** PII-free record shape allowed to reach the DB, UI, or logs. */
export interface CleanListing {
  sourceUrl: string;
  societyName: string | null;
  locality: string | null;
  lat: number | null;
  lng: number | null;
  rent: number | null;
  bedrooms: number | null;
  furnishing: string | null;
  amenities: string[];
  sqft: number | null;
  availabilityStatus: 'available' | 'not_for_rent';
}

/**
 * Strips PII by allowlisting only known-safe fields onto a brand-new object.
 * This is deliberately an allowlist (not a denylist of "name"/"phone"-shaped
 * keys) so that any current or future PII-risk field — however it's named on
 * the source site — can never leak through just because we didn't think to
 * ban that exact key name.
 */
export function stripPII(record: RawScrapedListing): CleanListing {
  return {
    sourceUrl: record.sourceUrl,
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
  };
}
