import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import SourcesPanel from './SourcesPanel';

describe('SourcesPanel', () => {
  it('dedupes citations by label+url and renders RAG links and OSM tags', () => {
    render(
      <SourcesPanel
        citations={[
          { label: 'Wikipedia: Koramangala', url: 'https://en.wikipedia.org/wiki/Koramangala', kind: 'rag' },
          { label: 'Wikipedia: Koramangala', url: 'https://en.wikipedia.org/wiki/Koramangala', kind: 'rag' },
          { label: 'OSM: find_nearby_places(transit)', kind: 'osm' },
        ]}
      />
    );

    const items = screen.getAllByTestId('citation-item');
    expect(items).toHaveLength(2);

    const link = screen.getByRole('link', { name: 'Wikipedia: Koramangala' });
    expect(link).toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Koramangala');

    expect(screen.getByText('OSM: find_nearby_places(transit)')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /OSM/i })).not.toBeInTheDocument();
  });

  it('renders a citation with no url as plain text, not a link', () => {
    render(<SourcesPanel citations={[{ label: 'Neighborhood guide (source pending)', kind: 'rag' }]} />);

    expect(screen.getByText('Neighborhood guide (source pending)')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
