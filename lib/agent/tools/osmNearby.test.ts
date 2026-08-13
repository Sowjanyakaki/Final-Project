import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMCPClient } from '@ai-sdk/mcp';
import { osmNearby } from './osmNearby';

vi.mock('@ai-sdk/mcp', () => ({
  createMCPClient: vi.fn(),
}));

const mockCreateClient = vi.mocked(createMCPClient);

describe('osmNearby', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OSM_MCP_URL = 'https://osm-mcp.example.com/sse';
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
