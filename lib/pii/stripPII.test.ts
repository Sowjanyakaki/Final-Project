import { describe, it, expect } from 'vitest';
import { stripPII, type RawScrapedListing } from './stripPII';

const baseRecord: RawScrapedListing = {
  sourceUrl: 'https://bengaluru.rent/listing/abc123',
  societyName: 'Prestige Lakeside Habitat',
  locality: 'Koramangala',
  lat: 12.9352,
  lng: 77.6146,
  rent: 35000,
  bedrooms: 2,
  furnishing: 'semi-furnished',
  amenities: ['parking', 'gym'],
  sqft: 1100,
  availabilityStatus: 'available',
};

describe('stripPII', () => {
  it('removes owner/agent/contact-style fields while keeping legitimate fields', () => {
    const raw: RawScrapedListing = {
      ...baseRecord,
      ownerName: 'Ramesh Kumar',
      agentName: 'Sunita Realty Agent',
      contactName: 'Ramesh',
      phone: '+91-9876543210',
      phoneNumber: '9876543210',
      whatsapp: '+919876543210',
    };

    const clean = stripPII(raw);

    expect(clean).not.toHaveProperty('ownerName');
    expect(clean).not.toHaveProperty('agentName');
    expect(clean).not.toHaveProperty('contactName');
    expect(clean).not.toHaveProperty('phone');
    expect(clean).not.toHaveProperty('phoneNumber');
    expect(clean).not.toHaveProperty('whatsapp');

    expect(clean).toEqual({
      sourceUrl: baseRecord.sourceUrl,
      societyName: baseRecord.societyName,
      locality: baseRecord.locality,
      lat: baseRecord.lat,
      lng: baseRecord.lng,
      rent: baseRecord.rent,
      bedrooms: baseRecord.bedrooms,
      furnishing: baseRecord.furnishing,
      amenities: baseRecord.amenities,
      sqft: baseRecord.sqft,
      availabilityStatus: baseRecord.availabilityStatus,
    });
  });

  it('drops PII fields even under unexpected/unknown key names', () => {
    const raw = {
      ...baseRecord,
      owner_contact: 'Ramesh, +91-9876543210',
      brokerMobile: '9876543210',
    } as RawScrapedListing;

    const clean = stripPII(raw);

    expect(clean).not.toHaveProperty('owner_contact');
    expect(clean).not.toHaveProperty('brokerMobile');
    expect(Object.keys(clean).sort()).toEqual(
      [
        'sourceUrl',
        'societyName',
        'locality',
        'lat',
        'lng',
        'rent',
        'bedrooms',
        'furnishing',
        'amenities',
        'sqft',
        'availabilityStatus',
      ].sort()
    );
  });

  it('passes a record with no PII fields through unchanged', () => {
    const clean = stripPII(baseRecord);
    expect(clean).toEqual(baseRecord);
  });
});
