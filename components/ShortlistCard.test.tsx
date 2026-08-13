import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ShortlistCard from './ShortlistCard';
import { Listing } from '../lib/types';

const baseListing: Listing = {
  id: 'listing-1',
  societyName: 'Prestige Falcon City',
  locality: 'Koramangala',
  rent: 35000,
  bedrooms: 2,
  furnishing: 'Semi-furnished',
  amenities: ['Parking', 'Gym', 'Lift', 'Power backup', 'Swimming pool'],
  sqft: 1100,
  availabilityStatus: 'available',
};

describe('ShortlistCard', () => {
  it('renders rent, bedrooms, area, and key amenities from props', () => {
    render(<ShortlistCard listing={baseListing} />);

    expect(screen.getByText('Prestige Falcon City')).toBeInTheDocument();
    expect(screen.getByTestId('listing-locality')).toHaveTextContent('Koramangala');
    expect(screen.getByTestId('listing-rent')).toHaveTextContent('35,000');
    expect(screen.getByTestId('listing-bedrooms')).toHaveTextContent('2 BHK');
    expect(screen.getByTestId('availability-badge')).toHaveTextContent('Available');

    const amenities = screen.getByTestId('amenities-list');
    expect(amenities).toHaveTextContent('Parking');
    expect(amenities).toHaveTextContent('Gym');
    expect(amenities).not.toHaveTextContent('Swimming pool'); // only first 4 amenities are shown
  });

  it('renders sensibly when amenities is empty', () => {
    render(<ShortlistCard listing={{ ...baseListing, amenities: [] }} />);

    expect(screen.getByTestId('amenities-empty')).toHaveTextContent('No amenities listed.');
    expect(screen.queryByTestId('amenities-list')).not.toBeInTheDocument();
  });
});
