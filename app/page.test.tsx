import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Home from './page';

vi.mock('../components/SearchBar', () => ({
  default: ({ onChange }: { onChange: (v: string) => void }) => (
    <button data-testid="search-stub" onClick={() => onChange('Koramangala')}>
      search stub
    </button>
  ),
}));
vi.mock('../components/FilterPills', () => ({
  default: ({ onBedroomsChange }: { onBedroomsChange: (b: number | undefined) => void }) => (
    <button data-testid="filter-stub" onClick={() => onBedroomsChange(2)}>
      filter stub
    </button>
  ),
}));

const fixtureItems = [
  {
    listing: {
      id: '1',
      societyName: 'Prestige Falcon City',
      locality: 'Koramangala',
      rent: 35000,
      bedrooms: 2,
      furnishing: 'Semi-furnished',
      amenities: ['Parking', 'Gym'],
      sqft: 1100,
      availabilityStatus: 'available',
      scrapedAt: '2026-08-10T00:00:00.000Z',
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
      id: '2',
      societyName: 'Sobha Dream Acres',
      locality: 'HSR Layout',
      rent: 42000,
      bedrooms: 2,
      furnishing: 'Unfurnished',
      amenities: ['Lift'],
      sqft: 950,
      availabilityStatus: 'available',
      scrapedAt: '2026-08-10T00:00:00.000Z',
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

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

describe('Home (companion UI shell)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ sessionId: 'sess-1', items: fixtureItems }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('loads the shortlist and renders a PropertyCard per item, plus EmailShortlistButton once a sessionId is known', async () => {
    render(<Home />);

    expect(screen.getByTestId('shortlist-loading')).toBeInTheDocument();

    await waitFor(() => expect(screen.getAllByTestId('property-card')).toHaveLength(2));

    expect(screen.getByText('Prestige Falcon City, Koramangala')).toBeInTheDocument();
    expect(screen.getByText('Sobha Dream Acres, HSR Layout')).toBeInTheDocument();
    expect(screen.getByTestId('booking-panel')).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledWith('/api/shortlist');
  });

  it('removes a card immediately when its heart button is clicked, and posts the removal', async () => {
    render(<Home />);
    await waitFor(() => expect(screen.getAllByTestId('property-card')).toHaveLength(2));

    fetchMock.mockResolvedValueOnce(jsonResponse({ changed: [1], unchanged: [2] }));
    fireEvent.click(screen.getByRole('button', { name: /remove prestige falcon city from shortlist/i }));

    await waitFor(() => expect(screen.getAllByTestId('property-card')).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/shortlist/remove',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ listingId: 1 }) })
    );
  });

  it('refetches the shortlist with a locality query param when the search bar reports a change', async () => {
    render(<Home />);
    await waitFor(() => expect(screen.getAllByTestId('property-card')).toHaveLength(2));

    fireEvent.click(screen.getByTestId('search-stub'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/shortlist?locality=Koramangala'));
  });

  it('refetches the shortlist with a bedrooms query param when a filter pill reports a change', async () => {
    render(<Home />);
    await waitFor(() => expect(screen.getAllByTestId('property-card')).toHaveLength(2));

    fireEvent.click(screen.getByTestId('filter-stub'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/shortlist?bedrooms=2'));
  });

  it('opens the voice sheet from the floating mic button', async () => {
    render(<Home />);
    await waitFor(() => expect(screen.getAllByTestId('property-card')).toHaveLength(2));

    expect(screen.queryByTestId('voice-sheet')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open voice assistant' }));
    expect(screen.getByTestId('voice-sheet')).toBeInTheDocument();
  });

  it('opens the voice sheet from the bottom nav AI Scout tab', async () => {
    render(<Home />);
    await waitFor(() => expect(screen.getAllByTestId('property-card')).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: 'AI Scout' }));
    expect(screen.getByTestId('voice-sheet')).toBeInTheDocument();
  });
});
