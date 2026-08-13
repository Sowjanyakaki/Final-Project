import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import NeighborhoodPanel from './NeighborhoodPanel';

describe('NeighborhoodPanel', () => {
  it('renders source tags for each claim in every section', () => {
    render(
      <NeighborhoodPanel
        snapshot={{
          transit: [{ text: 'Metro station 10 min walk', source: 'OSM: find_nearby_places(transit)' }],
          safety: [{ text: 'Well-lit main roads at night', source: 'Wikipedia: Koramangala' }],
          amenities: [{ text: 'Multiple supermarkets nearby', source: 'OSM: find_nearby_places(amenity)' }],
        }}
      />
    );

    const transitSection = screen.getByTestId('transit-section');
    expect(within(transitSection).getByText(/Metro station 10 min walk/)).toBeInTheDocument();
    expect(within(transitSection).getByText(/OSM: find_nearby_places\(transit\)/)).toBeInTheDocument();

    const safetySection = screen.getByTestId('safety-section');
    expect(within(safetySection).getByText(/Well-lit main roads at night/)).toBeInTheDocument();
    expect(within(safetySection).getByText(/Wikipedia: Koramangala/)).toBeInTheDocument();

    const amenitiesSection = screen.getByTestId('amenities-section');
    expect(within(amenitiesSection).getByText(/Multiple supermarkets nearby/)).toBeInTheDocument();
    expect(within(amenitiesSection).getByText(/OSM: find_nearby_places\(amenity\)/)).toBeInTheDocument();
  });

  it('shows an explicit unavailable message for uncertain or empty sections instead of leaving them blank', () => {
    render(
      <NeighborhoodPanel
        snapshot={{
          transit: [],
          safety: [{ text: 'Generally quiet residential lanes', source: 'Wikipedia: HSR Layout' }],
          amenities: [],
          uncertain: { amenities: true },
        }}
      />
    );

    expect(screen.getByTestId('transit-unavailable')).toHaveTextContent('Data unavailable for this area.');
    expect(screen.getByTestId('amenities-unavailable')).toHaveTextContent('Data unavailable for this area.');
    expect(screen.queryByTestId('safety-unavailable')).not.toBeInTheDocument();
    expect(screen.getByTestId('safety-section')).toHaveTextContent('Generally quiet residential lanes');
  });
});
