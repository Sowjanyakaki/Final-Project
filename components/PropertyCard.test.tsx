import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import PropertyCard from './PropertyCard';
import type { ShortlistApiItem } from '../lib/types';

const baseItem: ShortlistApiItem = {
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
    scrapedAt: '2026-08-10T00:00:00.000Z',
  },
  neighborhoodSnapshot: {
    transit: [],
    safety: [{ text: 'Well lit at night', source: 'Wikipedia: Koramangala' }],
    amenities: [],
    uncertain: { transit: true, amenities: true },
  },
  citations: [{ label: 'Wikipedia: Koramangala', url: 'https://en.wikipedia.org/wiki/Koramangala', kind: 'rag' }],
};

describe('PropertyCard', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders price, address, bedrooms, and sqft', () => {
    render(<PropertyCard item={baseItem} onRemove={vi.fn()} />);

    expect(screen.getByTestId('listing-rent')).toHaveTextContent('35,000');
    expect(screen.getByText('Prestige Falcon City, Koramangala')).toBeInTheDocument();
    expect(screen.getByTestId('listing-bedrooms')).toHaveTextContent('2 BHK');
    expect(screen.getByTestId('listing-sqft')).toHaveTextContent('1,100 sqft');
  });

  it('shows a New badge when scrapedAt is within the last 7 days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T00:00:00.000Z'));

    render(<PropertyCard item={baseItem} onRemove={vi.fn()} />);

    expect(screen.getByTestId('new-badge')).toBeInTheDocument();
  });

  it('hides the New badge when scrapedAt is more than 7 days old', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T00:00:00.000Z'));

    render(<PropertyCard item={baseItem} onRemove={vi.fn()} />);

    expect(screen.queryByTestId('new-badge')).not.toBeInTheDocument();
  });

  it('calls onRemove with the listing id when the heart button is clicked, without expanding the card', () => {
    const onRemove = vi.fn();
    render(<PropertyCard item={baseItem} onRemove={onRemove} />);

    fireEvent.click(screen.getByRole('button', { name: /remove prestige falcon city from shortlist/i }));

    expect(onRemove).toHaveBeenCalledWith('listing-1');
    expect(screen.queryByTestId('property-card-details')).not.toBeInTheDocument();
  });

  it('toggles expanded details (NeighborhoodPanel + SourcesPanel) when the card body is tapped', () => {
    render(<PropertyCard item={baseItem} onRemove={vi.fn()} />);

    expect(screen.queryByTestId('property-card-details')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /tap to expand details/i }));
    expect(screen.getByTestId('property-card-details')).toBeInTheDocument();
    expect(screen.getByTestId('neighborhood-panel')).toBeInTheDocument();
    expect(screen.getByTestId('sources-panel')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /tap to collapse details/i }));
    expect(screen.queryByTestId('property-card-details')).not.toBeInTheDocument();
  });
});
