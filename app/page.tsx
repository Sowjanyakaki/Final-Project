'use client';

import { useEffect, useState } from 'react';
import ShortlistCard from '../components/ShortlistCard';
import NeighborhoodPanel from '../components/NeighborhoodPanel';
import VoiceBar from '../components/VoiceBar';
import SourcesPanel from '../components/SourcesPanel';
import BookingPanel from '../components/BookingPanel';
import { Booking, Citation, ShortlistApiItem } from '../lib/types';

export default function Home() {
  const [items, setItems] = useState<ShortlistApiItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [booking] = useState<Booking | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    async function loadShortlist() {
      try {
        const res = await fetch('/api/shortlist');
        if (!res.ok) throw new Error('failed to load shortlist');
        const data: ShortlistApiItem[] = await res.json();
        if (!cancelled) {
          setItems(data);
        }
      } catch {
        if (!cancelled) {
          setError('Could not load your shortlist. Try again shortly.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadShortlist();

    return () => {
      cancelled = true;
    };
  }, []);

  const allCitations: Citation[] = items.flatMap((item) => item.citations);

  return (
    <main data-testid="companion-ui">
      <h1>Your Property Shortlist</h1>

      <VoiceBar />

      {loading && <p data-testid="shortlist-loading">Loading your shortlist...</p>}
      {error && <p data-testid="shortlist-error">{error}</p>}

      {!loading && !error && (
        <div data-testid="shortlist-items">
          {items.map((item) => (
            <div key={item.listing.id} data-testid="shortlist-item">
              <ShortlistCard listing={item.listing} />
              <NeighborhoodPanel snapshot={item.neighborhoodSnapshot} />
            </div>
          ))}
        </div>
      )}

      <SourcesPanel citations={allCitations} />
      <BookingPanel booking={booking} />
    </main>
  );
}
