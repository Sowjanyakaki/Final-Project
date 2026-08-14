'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Header from '../components/Header';
import Hero from '../components/Hero';
import SearchBar from '../components/SearchBar';
import FilterPills from '../components/FilterPills';
import PropertyCard from '../components/PropertyCard';
import BottomNav from '../components/BottomNav';
import FloatingMicButton from '../components/FloatingMicButton';
import VoiceSheet from '../components/VoiceSheet';
import BookingPanel from '../components/BookingPanel';
import { EmailShortlistButton } from '../components/EmailShortlistButton';
import { Booking, ShortlistApiItem, ShortlistApiResponse } from '../lib/types';

export default function Home() {
  const [items, setItems] = useState<ShortlistApiItem[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locality, setLocality] = useState('');
  const [bedrooms, setBedrooms] = useState<number | undefined>(undefined);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [booking] = useState<Booking | undefined>(undefined);

  const latestRequestRef = useRef(0);

  const loadShortlist = useCallback(async (nextLocality: string, nextBedrooms: number | undefined) => {
    const requestId = ++latestRequestRef.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (nextLocality) params.set('locality', nextLocality);
      if (nextBedrooms !== undefined) params.set('bedrooms', String(nextBedrooms));
      const query = params.toString();
      const res = await fetch(`/api/shortlist${query ? `?${query}` : ''}`);
      if (!res.ok) throw new Error('failed to load shortlist');
      const data: ShortlistApiResponse = await res.json();
      // Ignore this response if a newer request has started since — otherwise
      // a slow, superseded request (e.g. an earlier search keystroke) could
      // resolve after the current one and overwrite it with stale results.
      if (latestRequestRef.current !== requestId) return;
      setSessionId(data.sessionId);
      setItems(data.items);
    } catch {
      if (latestRequestRef.current !== requestId) return;
      setError('Could not load your shortlist. Try again shortly.');
    } finally {
      if (latestRequestRef.current === requestId) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadShortlist(locality, bedrooms);
  }, [locality, bedrooms, loadShortlist]);

  async function handleRemove(listingId: string) {
    const previous = items;
    setItems((current) => current.filter((item) => item.listing.id !== listingId));

    try {
      const res = await fetch('/api/shortlist/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId: Number(listingId) }),
      });
      if (!res.ok) throw new Error('remove failed');
    } catch {
      setItems(previous);
    }
  }

  return (
    <main data-testid="companion-ui">
      <Header />
      <Hero />
      <SearchBar defaultValue={locality} onChange={setLocality} />
      <FilterPills bedrooms={bedrooms} onBedroomsChange={setBedrooms} />

      <section aria-label="Featured properties">
        {loading && <p data-testid="shortlist-loading">Loading your shortlist...</p>}
        {error && <p data-testid="shortlist-error">{error}</p>}

        {!loading && !error && (
          <div data-testid="shortlist-items">
            {items.map((item) => (
              <PropertyCard key={item.listing.id} item={item} onRemove={handleRemove} />
            ))}
          </div>
        )}
      </section>

      {sessionId && <EmailShortlistButton sessionId={sessionId} />}
      <BookingPanel booking={booking} />

      <FloatingMicButton onClick={() => setVoiceOpen(true)} />
      <VoiceSheet open={voiceOpen} onClose={() => setVoiceOpen(false)} />
      <BottomNav onOpenVoice={() => setVoiceOpen(true)} />
    </main>
  );
}
