import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../../db/client';
import { searchListings } from './searchListings';

vi.mock('../../db/client', () => ({
  db: { select: vi.fn() },
}));

function mockDbRows(rows: unknown[]) {
  vi.mocked(db.select).mockReturnValue({
    from: () => ({
      where: () => Promise.resolve(rows),
    }),
  } as never);
}

const baseRow = {
  sourceUrl: 'https://bengaluru.rent/x',
  lat: 12.9,
  lng: 77.6,
  furnishing: 'semi-furnished',
  sqft: 900,
  scrapedAt: new Date('2026-01-01T00:00:00Z'),
};

const fixtureRows = [
  { ...baseRow, id: 1, societyName: 'Alpha', locality: 'Koramangala', rent: 30000, bedrooms: 2, amenities: ['parking', 'lift'], availabilityStatus: 'available' },
  { ...baseRow, id: 2, societyName: 'Beta', locality: 'Koramangala', rent: 45000, bedrooms: 2, amenities: ['parking'], availabilityStatus: 'available' },
  { ...baseRow, id: 3, societyName: 'Gamma', locality: 'Koramangala', rent: 38000, bedrooms: 2, amenities: ['lift'], availabilityStatus: 'available' },
  { ...baseRow, id: 4, societyName: 'Delta', locality: 'Koramangala', rent: 39000, bedrooms: 2, amenities: ['parking', 'lift', 'gym'], availabilityStatus: 'available' },
  { ...baseRow, id: 5, societyName: 'Epsilon', locality: 'Koramangala', rent: 20000, bedrooms: 2, amenities: ['parking'], availabilityStatus: 'not_for_rent' },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('searchListings', () => {
  it('excludes over-budget rows', async () => {
    mockDbRows(fixtureRows);
    const results = await searchListings({ budgetMax: 40000, bedrooms: 2 });
    expect(results.map((r) => r.id)).not.toContain(2);
  });

  it('excludes rows missing a required must-have amenity', async () => {
    mockDbRows(fixtureRows);
    const results = await searchListings({ budgetMax: 40000, bedrooms: 2, mustHaves: ['parking'] });
    expect(results.map((r) => r.id)).not.toContain(3);
    expect(results.map((r) => r.id)).toEqual(expect.arrayContaining([1, 4]));
  });

  it('always excludes not_for_rent rows even if they would otherwise match', async () => {
    mockDbRows(fixtureRows);
    const results = await searchListings({ budgetMax: 50000, bedrooms: 2 });
    expect(results.map((r) => r.id)).not.toContain(5);
  });

  it('ranks by closeness to budget, most-matching must-haves as tiebreak', async () => {
    mockDbRows(fixtureRows);
    // budgetMax=40000, no mustHaves: candidates are 1 (diff 10000), 3 (diff 2000), 4 (diff 1000).
    // id 2 (45000) is excluded by budget; id 5 is excluded as not_for_rent.
    const results = await searchListings({ budgetMax: 40000, bedrooms: 2 });
    expect(results.map((r) => r.id)).toEqual([4, 3, 1]);
  });

  it('breaks ties on budget-distance by must-have match count', async () => {
    mockDbRows(fixtureRows);
    // budgetMax=40000, mustHaves=['parking']: candidates are 1 (rent 30000, diff 10000) and 4 (rent 39000, diff 1000).
    // id 3 excluded (no parking). Expect closest-to-budget first regardless of match count (both match here).
    const results = await searchListings({ budgetMax: 40000, bedrooms: 2, mustHaves: ['parking'] });
    expect(results.map((r) => r.id)).toEqual([4, 1]);
  });
});
