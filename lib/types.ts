export type AvailabilityStatus = 'available' | 'not_for_rent';

export interface Listing {
  id: string;
  societyName: string;
  locality: string;
  rent: number;
  bedrooms: number;
  furnishing: string;
  amenities: string[];
  sqft: number;
  availabilityStatus: AvailabilityStatus;
}

export interface SourcedClaim {
  text: string;
  source: string;
}

export interface NeighborhoodSnapshot {
  transit: SourcedClaim[];
  safety: SourcedClaim[];
  amenities: SourcedClaim[];
  uncertain?: {
    transit?: boolean;
    safety?: boolean;
    amenities?: boolean;
  };
}

export type CitationKind = 'rag' | 'osm';

export interface Citation {
  label: string;
  url?: string;
  kind: CitationKind;
}

export type BookingStatus = 'tentative' | 'cancelled' | 'rescheduled';

export interface Booking {
  slotLabel: string;
  confirmationCode: string;
  status: BookingStatus;
}

export interface ShortlistApiItem {
  listing: Listing;
  neighborhoodSnapshot: NeighborhoodSnapshot;
  citations: Citation[];
}
