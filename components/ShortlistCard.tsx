import { Listing } from '../lib/types';

interface ShortlistCardProps {
  listing: Listing;
}

const MAX_AMENITIES_SHOWN = 4;

export default function ShortlistCard({ listing }: ShortlistCardProps) {
  const keyAmenities = listing.amenities.slice(0, MAX_AMENITIES_SHOWN);

  return (
    <article aria-label={listing.societyName} data-testid="shortlist-card">
      <h3>{listing.societyName}</h3>
      <p data-testid="listing-locality">{listing.locality}</p>
      <p data-testid="listing-rent">Rs {listing.rent.toLocaleString('en-IN')}/mo</p>
      <p data-testid="listing-bedrooms">{listing.bedrooms} BHK</p>
      <p data-testid="listing-sqft">{listing.sqft} sqft</p>
      <p data-testid="listing-furnishing">{listing.furnishing}</p>
      <span data-testid="availability-badge" data-status={listing.availabilityStatus}>
        {listing.availabilityStatus === 'available' ? 'Available' : 'Not for rent'}
      </span>
      {keyAmenities.length > 0 ? (
        <ul data-testid="amenities-list">
          {keyAmenities.map((amenity) => (
            <li key={amenity}>{amenity}</li>
          ))}
        </ul>
      ) : (
        <p data-testid="amenities-empty">No amenities listed.</p>
      )}
    </article>
  );
}
