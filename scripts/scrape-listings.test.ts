import { describe, it, expect, vi } from 'vitest';
import { parsePin, upsertListing } from './scrape-listings';
import { listings } from '../lib/db/schema';
import type { CleanListing } from '../lib/pii/stripPII';

describe('parsePin', () => {
  const baseRawPin = {
    id: 'ca5a5304-f117-4607-b8b1-25208b509057',
    lat: 12.9352,
    lng: 77.6245,
    rent_amount: 40000,
    bhk: '3',
    sqft: 1400,
    furnished: false,
    gated: true,
    society: 'Coevolve florenza',
    feedback: null,
    looking_for_flatmate: false,
    deposit_months: '3',
    maintenance_included: true,
    pet_friendly: 'yes',
    occupant_type: 'family',
    listing_type: 'whole_flat',
    available_from: 'flexible',
    pin_kind: 'rent',
    is_suspicious: false,
    created_at: '2026-08-10T05:08:03.728598+00:00',
  };

  it('maps an available whole_flat pin, deriving amenity tags from the real fields', () => {
    const parsed = parsePin(baseRawPin);

    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({
      sourceUrl: `https://bengaluru.rent/?pin=${baseRawPin.id}`,
      societyName: 'Coevolve florenza',
      locality: 'Koramangala',
      lat: 12.9352,
      lng: 77.6245,
      rent: 40000,
      bedrooms: 3,
      furnishing: 'unfurnished',
      sqft: 1400,
      availabilityStatus: 'available',
    });
    expect(parsed?.amenities).toEqual(
      expect.arrayContaining(['gated community', 'maintenance included', 'pet friendly'])
    );
  });

  it('returns null for a transparency-only pin (listing_type null — the "Not for rent" case)', () => {
    expect(parsePin({ ...baseRawPin, listing_type: null })).toBeNull();
  });

  it('returns null for a "Spot a To-Let" board pin (pin_kind tolet_spot)', () => {
    expect(parsePin({ ...baseRawPin, pin_kind: 'tolet_spot' })).toBeNull();
  });

  it('returns null for pins flagged suspicious', () => {
    expect(parsePin({ ...baseRawPin, is_suspicious: true })).toBeNull();
  });

  it('returns null when there is no usable id', () => {
    expect(parsePin({ ...baseRawPin, id: undefined })).toBeNull();
  });

  it('parses "5+" bhk as 5 bedrooms and numeric-string bhk as a number', () => {
    expect(parsePin({ ...baseRawPin, bhk: '5+' })?.bedrooms).toBe(5);
    expect(parsePin({ ...baseRawPin, bhk: '2' })?.bedrooms).toBe(2);
  });

  it('does not throw on missing/malformed optional fields, and nulls them out', () => {
    const malformed = {
      id: 'pin-7',
      lat: null,
      lng: null,
      rent_amount: null,
      bhk: null,
      sqft: null,
      furnished: null,
      gated: null,
      society: null,
      listing_type: 'room',
      pin_kind: 'rent',
      is_suspicious: false,
    };

    const parsed = parsePin(malformed);

    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({
      sourceUrl: 'https://bengaluru.rent/?pin=pin-7',
      societyName: null,
      locality: null,
      lat: null,
      lng: null,
      rent: null,
      bedrooms: null,
      furnishing: null,
      sqft: null,
      availabilityStatus: 'available',
    });
    expect(parsed?.amenities).toEqual([]);
  });

  it('returns null for non-object input instead of throwing', () => {
    expect(parsePin(null)).toBeNull();
    expect(parsePin(undefined)).toBeNull();
    expect(parsePin('not a pin')).toBeNull();
    expect(parsePin(42)).toBeNull();
  });
});

describe('upsertListing', () => {
  const cleanRecord: CleanListing = {
    sourceUrl: 'https://bengaluru.rent/?pin=ca5a5304-f117-4607-b8b1-25208b509057',
    societyName: 'Coevolve florenza',
    locality: 'Koramangala',
    lat: 12.9352,
    lng: 77.6245,
    rent: 40000,
    bedrooms: 3,
    furnishing: 'unfurnished',
    amenities: ['gated community'],
    sqft: 1400,
    availabilityStatus: 'available',
  };

  it('inserts with an onConflictDoUpdate keyed by sourceUrl', async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn((_values: unknown) => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));
    const fakeDb = { insert } as unknown as Parameters<typeof upsertListing>[1];

    await upsertListing(cleanRecord, fakeDb);

    expect(insert).toHaveBeenCalledWith(listings);
    expect(values).toHaveBeenCalledTimes(1);
    const insertedValues = values.mock.calls[0][0] as { scrapedAt: Date; [key: string]: unknown };
    expect(insertedValues).toMatchObject({
      sourceUrl: cleanRecord.sourceUrl,
      societyName: cleanRecord.societyName,
      rent: cleanRecord.rent,
      availabilityStatus: 'available',
    });
    expect(insertedValues.scrapedAt).toBeInstanceOf(Date);

    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
    const conflictArg = onConflictDoUpdate.mock.calls[0][0];
    expect(conflictArg.target).toBe(listings.sourceUrl);
    expect(conflictArg.set).toMatchObject({
      societyName: cleanRecord.societyName,
      rent: cleanRecord.rent,
    });
  });
});
