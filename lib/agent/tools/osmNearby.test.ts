import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMCPClient } from '@ai-sdk/mcp';
import { osmNearby, openOsmSession, __clearOsmCacheForTests } from './osmNearby';

vi.mock('@ai-sdk/mcp', () => ({
  createMCPClient: vi.fn(),
}));

const mockCreateClient = vi.mocked(createMCPClient);

describe('osmNearby', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearOsmCacheForTests();
    process.env.OSM_MCP_URL = 'https://osm-mcp.example.com';
  });

  it('connects over streamable HTTP at the /mcp path, not SSE', async () => {
    mockCreateClient.mockResolvedValue({
      tools: vi.fn().mockResolvedValue({ find_nearby_places: { execute: vi.fn().mockResolvedValue({ categories: {} }) } }),
      close: vi.fn().mockResolvedValue(undefined),
    } as never);

    await osmNearby({ lat: 12.93, lng: 77.61, category: 'amenities' });

    expect(mockCreateClient).toHaveBeenCalledWith({
      transport: { type: 'http', url: 'https://osm-mcp.example.com/mcp' },
    });
  });

  it('does not double up the /mcp path when OSM_MCP_URL already has a trailing slash', async () => {
    process.env.OSM_MCP_URL = 'https://osm-mcp.example.com/';
    mockCreateClient.mockResolvedValue({
      tools: vi.fn().mockResolvedValue({ find_nearby_places: { execute: vi.fn().mockResolvedValue({ categories: {} }) } }),
      close: vi.fn().mockResolvedValue(undefined),
    } as never);

    await osmNearby({ lat: 12.93, lng: 77.61, category: 'amenities' });

    expect(mockCreateClient).toHaveBeenCalledWith({
      transport: { type: 'http', url: 'https://osm-mcp.example.com/mcp' },
    });
  });

  it('calls find_nearby_places for an "amenities" category and unwraps + flattens the real CallToolResult envelope', async () => {
    // Real shape confirmed against the live server: the AI SDK MCP client's
    // tool.execute() returns the full MCP CallToolResult envelope
    // ({content, structuredContent, isError}), and find_nearby_places'
    // actual payload nests places two levels deep at
    // structuredContent.result.categories[tagKey][subcategory][].
    const executeFindNearby = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{"categories":{}}' }],
      structuredContent: {
        result: {
          query: { latitude: 12.93, longitude: 77.61, radius: 1000 },
          categories: {
            amenity: {
              restaurant: [{ id: 1, name: 'Forum Mall Food Court', latitude: 12.93, longitude: 77.61 }],
            },
            shop: {
              pharmacy: [{ id: 2, name: 'Apollo Pharmacy', latitude: 12.93, longitude: 77.61 }],
            },
          },
          total_count: 2,
        },
      },
      isError: false,
    });
    mockCreateClient.mockResolvedValue({
      tools: vi.fn().mockResolvedValue({
        find_nearby_places: { execute: executeFindNearby },
        analyze_commute: { execute: vi.fn() },
        analyze_neighborhood: { execute: vi.fn() },
      }),
      close: vi.fn().mockResolvedValue(undefined),
    } as never);

    const result = await osmNearby({ lat: 12.93, lng: 77.61, category: 'amenities' });

    expect(result).toEqual({
      items: [
        { name: 'Forum Mall Food Court', type: 'amenity/restaurant' },
        { name: 'Apollo Pharmacy', type: 'shop/pharmacy' },
      ],
      uncertain: false,
    });
    expect(executeFindNearby).toHaveBeenCalledWith(
      { latitude: 12.93, longitude: 77.61, categories: ['amenity', 'shop'] },
      expect.anything()
    );
  });

  it('falls back to parsing content[0].text as JSON when structuredContent is absent', async () => {
    const executeFindNearby = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ categories: { amenity: { cafe: [{ id: 3, name: 'Cafe Coffee Day' }] } } }),
        },
      ],
      isError: false,
    });
    mockCreateClient.mockResolvedValue({
      tools: vi.fn().mockResolvedValue({ find_nearby_places: { execute: executeFindNearby } }),
      close: vi.fn().mockResolvedValue(undefined),
    } as never);

    const result = await osmNearby({ lat: 12.93, lng: 77.61, category: 'amenities' });

    expect(result).toEqual({
      items: [{ name: 'Cafe Coffee Day', type: 'amenity/cafe' }],
      uncertain: false,
    });
  });

  it('treats isError:true as no data rather than throwing or fabricating a result', async () => {
    const executeFindNearby = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Error executing tool find_nearby_places: Failed to get nearby POIs: 406' }],
      isError: true,
    });
    mockCreateClient.mockResolvedValue({
      tools: vi.fn().mockResolvedValue({ find_nearby_places: { execute: executeFindNearby } }),
      close: vi.fn().mockResolvedValue(undefined),
    } as never);

    const result = await osmNearby({ lat: 12.93, lng: 77.61, category: 'amenities' });

    expect(result.items).toEqual([]);
    expect(result.uncertain).toBe(true);
  });

  it('calls find_nearby_places for a "transit" category with transit-specific tag keys and marks uncertain on an empty result', async () => {
    const executeFindNearby = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{"categories":{},"total_count":0}' }],
      structuredContent: { result: { categories: {}, total_count: 0 } },
      isError: false,
    });
    mockCreateClient.mockResolvedValue({
      tools: vi.fn().mockResolvedValue({
        find_nearby_places: { execute: executeFindNearby },
      }),
      close: vi.fn().mockResolvedValue(undefined),
    } as never);

    const result = await osmNearby({ lat: 12.93, lng: 77.61, category: 'transit' });

    expect(result).toEqual({
      items: [],
      uncertain: true,
      note: 'No transit data available near this location',
    });
    expect(executeFindNearby).toHaveBeenCalledWith(
      { latitude: 12.93, longitude: 77.61, categories: ['public_transport', 'railway', 'highway'] },
      expect.anything()
    );
  });

  it('calls find_schools_nearby for a "schools" category and normalizes its real response shape', async () => {
    // Real shape confirmed against the deployed server's actual return
    // statement (osm_mcp_server/server.py, find_schools_nearby): a flat
    // `schools` array (not the categories[tagKey][subcategory] nesting
    // find_nearby_places uses), each with `school_type` often empty in
    // real OSM data — falls back to `amenity_type`, which the query always
    // populates since that's the OSM tag being searched on.
    const executeFindSchools = vi.fn().mockResolvedValue({
      structuredContent: {
        result: {
          query: { latitude: 12.93, longitude: 77.61, radius: 2000, education_levels: null },
          schools: [
            {
              id: 111,
              name: "St. Xavier's School",
              amenity_type: 'school',
              school_type: '',
              education_level: '',
              coordinates: { latitude: 12.931, longitude: 77.611 },
              distance: 450.2,
              address: { street: '', housenumber: '', city: '', postcode: '' },
              tags: { amenity: 'school', name: "St. Xavier's School" },
            },
            {
              id: 222,
              name: 'Bishop Cotton University',
              amenity_type: 'university',
              school_type: 'secondary',
              education_level: '',
              coordinates: { latitude: 12.935, longitude: 77.615 },
              distance: 890.6,
              address: {},
              tags: {},
            },
          ],
          count: 2,
        },
      },
      isError: false,
    });
    mockCreateClient.mockResolvedValue({
      tools: vi.fn().mockResolvedValue({ find_schools_nearby: { execute: executeFindSchools } }),
      close: vi.fn().mockResolvedValue(undefined),
    } as never);

    const result = await osmNearby({ lat: 12.93, lng: 77.61, category: 'schools' });

    expect(result).toEqual({
      items: [
        { name: "St. Xavier's School", type: 'school/school', distanceMeters: 450.2 },
        { name: 'Bishop Cotton University', type: 'school/secondary', distanceMeters: 890.6 },
      ],
      uncertain: false,
    });
    expect(executeFindSchools).toHaveBeenCalledWith({ latitude: 12.93, longitude: 77.61 }, expect.anything());
  });

  it('routes an "education" category to find_schools_nearby too', async () => {
    const executeFindSchools = vi.fn().mockResolvedValue({
      structuredContent: { result: { query: {}, schools: [], count: 0 } },
    });
    mockCreateClient.mockResolvedValue({
      tools: vi.fn().mockResolvedValue({ find_schools_nearby: { execute: executeFindSchools } }),
      close: vi.fn().mockResolvedValue(undefined),
    } as never);

    const result = await osmNearby({ lat: 12.93, lng: 77.61, category: 'education' });

    expect(executeFindSchools).toHaveBeenCalledTimes(1);
    expect(result.uncertain).toBe(true);
    expect(result.note).toBe('No education data available near this location');
  });

  it('calls analyze_commute for a "commute" category and marks uncertain (never throws) when the call rejects', async () => {
    const executeAnalyzeCommute = vi.fn().mockRejectedValue(new Error('upstream timeout'));
    mockCreateClient.mockResolvedValue({
      tools: vi.fn().mockResolvedValue({
        analyze_commute: { execute: executeAnalyzeCommute },
      }),
      close: vi.fn().mockResolvedValue(undefined),
    } as never);

    const result = await osmNearby({ lat: 12.93, lng: 77.61, category: 'commute' });

    expect(result.items).toEqual([]);
    expect(result.uncertain).toBe(true);
    expect(result.note).toContain('upstream timeout');
    expect(executeAnalyzeCommute).toHaveBeenCalledTimes(1);
  });

  it('calls analyze_neighborhood for any other category and flattens the real categories[name].features shape', async () => {
    // Real shape confirmed against the live server's actual return statement:
    // structuredContent.result.categories[categoryName].features[], each with a distance.
    // (The function's internal Python variable is named "results", but the
    // returned JSON key is "categories" — same key name find_nearby_places
    // uses, one level shallower.)
    const executeAnalyzeNeighborhood = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{"categories":{}}' }],
      structuredContent: {
        result: {
          location: { coordinates: { latitude: 12.93, longitude: 77.61 }, address: 'Koramangala, Bengaluru' },
          scores: { overall: 6.4, walkability: 8, categories: { parks: 6.4 } },
          categories: {
            parks: {
              count: 1,
              features: [{ id: 1, name: 'Koramangala 5th Block Park', type: 'node', distance: 320.5 }],
              metrics: { total_count: 1, avg_distance: 320.5, min_distance: 320.5 },
            },
          },
        },
      },
      isError: false,
    });
    mockCreateClient.mockResolvedValue({
      tools: vi.fn().mockResolvedValue({
        analyze_neighborhood: { execute: executeAnalyzeNeighborhood },
      }),
      close: vi.fn().mockResolvedValue(undefined),
    } as never);

    const result = await osmNearby({ lat: 12.93, lng: 77.61, category: 'livability' });

    expect(result.uncertain).toBe(false);
    expect(result.items).toEqual([{ name: 'Koramangala 5th Block Park', type: 'parks', distanceMeters: 320.5 }]);
    expect(executeAnalyzeNeighborhood).toHaveBeenCalledWith({ latitude: 12.93, longitude: 77.61 }, expect.anything());
  });

  it('returns uncertain when OSM_MCP_URL is not configured, without throwing', async () => {
    delete process.env.OSM_MCP_URL;

    const result = await osmNearby({ lat: 12.93, lng: 77.61, category: 'amenities' });

    expect(result.uncertain).toBe(true);
    expect(result.items).toEqual([]);
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
});

describe('openOsmSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearOsmCacheForTests();
    process.env.OSM_MCP_URL = 'https://osm-mcp.example.com';
  });

  it('connects and discovers tools only once, reusing them across multiple query() calls', async () => {
    const toolsMock = vi.fn().mockResolvedValue({
      find_nearby_places: {
        execute: vi.fn().mockResolvedValue({
          structuredContent: { result: { categories: { amenity: { cafe: [{ id: 1, name: 'Cafe Coffee Day' }] } } } },
        }),
      },
    });
    const closeMock = vi.fn().mockResolvedValue(undefined);
    mockCreateClient.mockResolvedValue({ tools: toolsMock, close: closeMock } as never);

    const session = await openOsmSession();
    const first = await session.query({ lat: 12.93, lng: 77.61, category: 'amenities' });
    const second = await session.query({ lat: 12.94, lng: 77.62, category: 'amenities' });
    await session.close();

    expect(mockCreateClient).toHaveBeenCalledTimes(1);
    expect(toolsMock).toHaveBeenCalledTimes(1);
    expect(first.items).toEqual([{ name: 'Cafe Coffee Day', type: 'amenity/cafe' }]);
    expect(second.items).toEqual([{ name: 'Cafe Coffee Day', type: 'amenity/cafe' }]);
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('returns a session whose query() is always uncertain, without connecting, when OSM_MCP_URL is not configured', async () => {
    delete process.env.OSM_MCP_URL;

    const session = await openOsmSession();
    const result = await session.query({ lat: 12.93, lng: 77.61, category: 'amenities' });
    await session.close();

    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(result).toEqual({ items: [], uncertain: true, note: 'OSM_MCP_URL is not configured' });
  });

  it('returns a session whose query() is uncertain, without throwing, when the initial connection itself fails', async () => {
    mockCreateClient.mockRejectedValue(new Error('connection refused'));

    const session = await openOsmSession();
    const result = await session.query({ lat: 12.93, lng: 77.61, category: 'amenities' });
    await expect(session.close()).resolves.toBeUndefined();

    expect(result.uncertain).toBe(true);
    expect(result.note).toContain('connection refused');
  });
});

describe('osmNearby result caching', () => {
  // The real OSM MCP server proxies to the public Overpass API, which is
  // slow (~3-4s per query, confirmed live) and doesn't reliably scale with
  // concurrent requests (12 "parallel" lookups still took ~34s live, and a
  // probe request outright failed to connect to overpass-api.de once).
  // Caching by coordinate+category means a repeat page load — the common
  // case in this app, since GET /api/shortlist looks up the same handful
  // of listings' locations every time — doesn't re-pay that cost.
  const executeFindNearby = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    __clearOsmCacheForTests();
    process.env.OSM_MCP_URL = 'https://osm-mcp.example.com';
    executeFindNearby.mockResolvedValue({
      structuredContent: { result: { categories: { amenity: { cafe: [{ id: 1, name: 'Cafe Coffee Day' }] } } } },
    });
    mockCreateClient.mockResolvedValue({
      tools: vi.fn().mockResolvedValue({ find_nearby_places: { execute: executeFindNearby } }),
      close: vi.fn().mockResolvedValue(undefined),
    } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('serves a second lookup for the same coordinates and category from cache, without querying OSM again', async () => {
    const first = await osmNearby({ lat: 12.93, lng: 77.61, category: 'amenities' });
    const second = await osmNearby({ lat: 12.93, lng: 77.61, category: 'amenities' });

    expect(executeFindNearby).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it('queries again for a different category at the same coordinates', async () => {
    executeFindNearby.mockResolvedValue({ structuredContent: { result: { categories: {} } } });

    await osmNearby({ lat: 12.93, lng: 77.61, category: 'amenities' });
    await osmNearby({ lat: 12.93, lng: 77.61, category: 'transit' });

    expect(executeFindNearby).toHaveBeenCalledTimes(2);
  });

  it('queries again once the cache entry has expired', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    await osmNearby({ lat: 12.93, lng: 77.61, category: 'amenities' });
    vi.setSystemTime(new Date('2026-01-01T01:00:00.000Z')); // well past any reasonable TTL
    await osmNearby({ lat: 12.93, lng: 77.61, category: 'amenities' });

    expect(executeFindNearby).toHaveBeenCalledTimes(2);
  });

  it('does not cache an uncertain result, so a transient failure is retried on the next lookup', async () => {
    executeFindNearby.mockResolvedValueOnce({ isError: true, content: [{ type: 'text', text: 'boom' }] });
    executeFindNearby.mockResolvedValueOnce({
      structuredContent: { result: { categories: { amenity: { cafe: [{ id: 1, name: 'Cafe Coffee Day' }] } } } },
    });

    const first = await osmNearby({ lat: 12.93, lng: 77.61, category: 'amenities' });
    const second = await osmNearby({ lat: 12.93, lng: 77.61, category: 'amenities' });

    expect(first.uncertain).toBe(true);
    expect(second.uncertain).toBe(false);
    expect(executeFindNearby).toHaveBeenCalledTimes(2);
  });
});
