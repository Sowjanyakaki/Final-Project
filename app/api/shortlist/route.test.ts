import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetOrCreateSession } = vi.hoisted(() => ({ mockGetOrCreateSession: vi.fn() }));
const { mockSearchListings } = vi.hoisted(() => ({ mockSearchListings: vi.fn() }));
const { mockRetrieveNeighborhoodDocs } = vi.hoisted(() => ({ mockRetrieveNeighborhoodDocs: vi.fn() }));
const { mockOsmNearby } = vi.hoisted(() => ({ mockOsmNearby: vi.fn() }));
const { mockCookieGet, mockCookieSet, mockCookies } = vi.hoisted(() => {
  const mockCookieGet = vi.fn();
  const mockCookieSet = vi.fn();
  const mockCookies = vi.fn(() => Promise.resolve({ get: mockCookieGet, set: mockCookieSet }));
  return { mockCookieGet, mockCookieSet, mockCookies };
});
const { mockSelect, mockFrom, mockWhere, mockInsert, mockValues } = vi.hoisted(() => {
  const mockWhere = vi.fn();
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  const mockValues = vi.fn().mockResolvedValue(undefined);
  const mockInsert = vi.fn(() => ({ values: mockValues }));
  return { mockSelect, mockFrom, mockWhere, mockInsert, mockValues };
});

vi.mock('../../../lib/db/client', () => ({ db: { select: mockSelect, insert: mockInsert } }));
vi.mock('../../../lib/agent/session', () => ({ getOrCreateSession: mockGetOrCreateSession }));
vi.mock('../../../lib/agent/tools/searchListings', () => ({ searchListings: mockSearchListings }));
vi.mock('../../../lib/agent/tools/retrieveNeighborhoodDocs', () => ({
  retrieveNeighborhoodDocs: mockRetrieveNeighborhoodDocs,
}));
vi.mock('../../../lib/agent/tools/osmNearby', () => ({ osmNearby: mockOsmNearby }));
vi.mock('next/headers', () => ({ cookies: mockCookies }));

import { GET } from './route';

function makeRequest(query = ''): Request {
  return new Request(`http://localhost/api/shortlist${query}`);
}

const listingRow = {
  id: 1,
  sourceUrl: 'https://example.com/1',
  societyName: 'Prestige Falcon City',
  locality: 'Koramangala',
  lat: 12.93,
  lng: 77.61,
  rent: 35000,
  bedrooms: 2,
  furnishing: 'Semi-furnished',
  amenities: ['Parking'],
  sqft: 1100,
  availabilityStatus: 'available' as const,
  scrapedAt: new Date('2026-08-10T00:00:00.000Z'),
};

describe('GET /api/shortlist', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCookies.mockReturnValue(Promise.resolve({ get: mockCookieGet, set: mockCookieSet }));
    mockCookieGet.mockReturnValue(undefined);
    mockGetOrCreateSession.mockResolvedValue({ id: 'sess-1', isNew: true });
    mockSearchListings.mockResolvedValue([listingRow]);
    mockRetrieveNeighborhoodDocs.mockResolvedValue({ chunks: [], uncertain: true });
    mockOsmNearby.mockResolvedValue({ items: [], uncertain: true });
    mockWhere.mockResolvedValue([]);
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockInsert.mockReturnValue({ values: mockValues });
  });

  it('creates a session, seeds new results as active shortlistItems, and returns sessionId + items', async () => {
    const res = await GET(makeRequest());
    const json = await res.json();

    expect(mockGetOrCreateSession).toHaveBeenCalledWith(undefined);
    expect(mockSearchListings).toHaveBeenCalledWith({ locality: undefined, bedrooms: undefined });
    expect(mockValues).toHaveBeenCalledWith([
      expect.objectContaining({ sessionId: 'sess-1', listingId: 1, status: 'active' }),
    ]);
    expect(json.sessionId).toBe('sess-1');
    expect(json.items).toHaveLength(1);
    expect(json.items[0].listing).toEqual(
      expect.objectContaining({ id: '1', societyName: 'Prestige Falcon City', scrapedAt: '2026-08-10T00:00:00.000Z' })
    );
  });

  it('passes locality and bedrooms query params through to searchListings', async () => {
    await GET(makeRequest('?locality=Koramangala&bedrooms=2'));

    expect(mockSearchListings).toHaveBeenCalledWith({ locality: 'Koramangala', bedrooms: 2 });
  });

  it('does not re-insert a listing that already has a shortlistItems row for this session', async () => {
    mockWhere.mockResolvedValue([{ listingId: 1, status: 'active' }]);

    await GET(makeRequest());

    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('excludes a listing whose shortlistItems row for this session is dropped, even though it still matches search', async () => {
    mockWhere.mockResolvedValue([{ listingId: 1, status: 'dropped' }]);

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(json.items).toHaveLength(0);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('reuses the session id from an existing cookie', async () => {
    mockCookieGet.mockReturnValue({ value: 'sess-existing' });
    mockGetOrCreateSession.mockResolvedValue({ id: 'sess-existing', isNew: false });

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(mockGetOrCreateSession).toHaveBeenCalledWith('sess-existing');
    expect(json.sessionId).toBe('sess-existing');
  });

  it('includes real transit and amenities data from osmNearby for a listing with coordinates', async () => {
    mockOsmNearby.mockImplementation(({ category }: { category: string }) => {
      if (category === 'transit') {
        return Promise.resolve({
          items: [{ name: 'Koramangala Metro', type: 'public_transport/station', distanceMeters: 420 }],
          uncertain: false,
        });
      }
      return Promise.resolve({
        items: [{ name: 'Forum Mall', type: 'amenity/mall' }],
        uncertain: false,
      });
    });

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(mockOsmNearby).toHaveBeenCalledWith({ lat: 12.93, lng: 77.61, category: 'transit' });
    expect(mockOsmNearby).toHaveBeenCalledWith({ lat: 12.93, lng: 77.61, category: 'amenities' });

    const snapshot = json.items[0].neighborhoodSnapshot;
    expect(snapshot.uncertain.transit).toBe(false);
    expect(snapshot.uncertain.amenities).toBe(false);
    expect(snapshot.transit[0].text).toContain('Koramangala Metro');
    expect(snapshot.transit[0].text).toContain('420m');
    expect(snapshot.amenities[0].text).toContain('Forum Mall');

    const osmCitations = json.items[0].citations.filter((c: { kind: string }) => c.kind === 'osm');
    expect(osmCitations.length).toBeGreaterThan(0);
  });

  it('marks transit and amenities uncertain, without calling osmNearby, for a listing with no coordinates', async () => {
    mockSearchListings.mockResolvedValue([{ ...listingRow, lat: null, lng: null }]);

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(mockOsmNearby).not.toHaveBeenCalled();
    expect(json.items[0].neighborhoodSnapshot.uncertain.transit).toBe(true);
    expect(json.items[0].neighborhoodSnapshot.uncertain.amenities).toBe(true);
    expect(json.items[0].neighborhoodSnapshot.transit).toEqual([]);
    expect(json.items[0].neighborhoodSnapshot.amenities).toEqual([]);
  });
});
