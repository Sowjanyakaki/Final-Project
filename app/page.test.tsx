import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Home from './page';
import { useVoiceRecorder } from '../lib/voice/useVoiceRecorder';

vi.mock('../lib/voice/useVoiceRecorder', () => ({
  useVoiceRecorder: vi.fn(),
}));

const fixtureItems = [
  {
    listing: {
      id: 'listing-1',
      societyName: 'Prestige Falcon City',
      locality: 'Koramangala',
      rent: 35000,
      bedrooms: 2,
      furnishing: 'Semi-furnished',
      amenities: ['Parking', 'Gym'],
      sqft: 1100,
      availabilityStatus: 'available',
    },
    neighborhoodSnapshot: {
      transit: [{ text: 'Metro 10 min walk', source: 'OSM: find_nearby_places(transit)' }],
      safety: [{ text: 'Well lit at night', source: 'Wikipedia: Koramangala' }],
      amenities: [{ text: 'Several supermarkets', source: 'OSM: find_nearby_places(amenity)' }],
    },
    citations: [
      { label: 'Wikipedia: Koramangala', url: 'https://en.wikipedia.org/wiki/Koramangala', kind: 'rag' },
      { label: 'OSM: find_nearby_places(transit)', kind: 'osm' },
    ],
  },
  {
    listing: {
      id: 'listing-2',
      societyName: 'Sobha Dream Acres',
      locality: 'HSR Layout',
      rent: 42000,
      bedrooms: 2,
      furnishing: 'Unfurnished',
      amenities: ['Lift'],
      sqft: 950,
      availabilityStatus: 'available',
    },
    neighborhoodSnapshot: {
      transit: [],
      safety: [{ text: 'Quiet residential lanes', source: 'Wikipedia: HSR Layout' }],
      amenities: [],
      uncertain: { transit: true, amenities: true },
    },
    citations: [{ label: 'Wikipedia: HSR Layout', url: 'https://en.wikipedia.org/wiki/HSR_Layout', kind: 'rag' }],
  },
];

describe('Home (companion UI shell)', () => {
  beforeEach(() => {
    vi.mocked(useVoiceRecorder).mockReturnValue({
      isRecording: false,
      start: vi.fn(),
      stop: vi.fn().mockResolvedValue(new Blob()),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => fixtureItems,
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('loads the shortlist and renders a card, neighborhood panel, sources, and booking panel per item', async () => {
    render(<Home />);

    expect(screen.getByTestId('shortlist-loading')).toBeInTheDocument();

    await waitFor(() => expect(screen.getAllByTestId('shortlist-item')).toHaveLength(2));

    expect(screen.getByText('Prestige Falcon City')).toBeInTheDocument();
    expect(screen.getByText('Sobha Dream Acres')).toBeInTheDocument();

    expect(screen.getAllByTestId('neighborhood-panel')).toHaveLength(2);

    expect(screen.getByRole('link', { name: 'Wikipedia: Koramangala' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Wikipedia: HSR Layout' })).toBeInTheDocument();

    expect(screen.getByTestId('booking-empty')).toBeInTheDocument();

    expect(screen.getByTestId('voice-bar')).toBeInTheDocument();

    expect(fetch).toHaveBeenCalledWith('/api/shortlist');
  });
});
