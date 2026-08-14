'use client';

import { useState } from 'react';
import styles from './PropertyCard.module.css';
import { HeartIcon, BedIcon, SqftIcon } from './icons/icons';
import NeighborhoodPanel from './NeighborhoodPanel';
import SourcesPanel from './SourcesPanel';
import type { ShortlistApiItem } from '../lib/types';

const NEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

interface PropertyCardProps {
  item: ShortlistApiItem;
  onRemove: (listingId: string) => void;
}

export default function PropertyCard({ item, onRemove }: PropertyCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { listing } = item;
  const isNew = Date.now() - new Date(listing.scrapedAt).getTime() < NEW_WINDOW_MS;

  function toggleExpanded() {
    setExpanded((prev) => !prev);
  }

  return (
    <article className={styles.card} data-testid="property-card">
      <div
        className={styles.imageWrap}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`${listing.societyName}, tap to ${expanded ? 'collapse' : 'expand'} details`}
        onClick={toggleExpanded}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleExpanded();
          }
        }}
      >
        <img src="/property-placeholder.svg" alt="" className={styles.image} />
        {isNew && (
          <span className={styles.newBadge} data-testid="new-badge">
            New
          </span>
        )}
        <button
          type="button"
          className={styles.heartButton}
          aria-label={`Remove ${listing.societyName} from shortlist`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove(listing.id);
          }}
        >
          <HeartIcon />
        </button>
      </div>

      <div className={styles.body}>
        <p className={styles.price} data-testid="listing-rent">
          Rs {listing.rent.toLocaleString('en-IN')}/mo
        </p>
        <p className={styles.address}>
          {listing.societyName}, {listing.locality}
        </p>
        <div className={styles.meta}>
          <span data-testid="listing-bedrooms">
            <BedIcon /> {listing.bedrooms} BHK
          </span>
          <span data-testid="listing-sqft">
            <SqftIcon /> {listing.sqft.toLocaleString('en-IN')} sqft
          </span>
        </div>
      </div>

      {expanded && (
        <div className={styles.details} data-testid="property-card-details">
          <NeighborhoodPanel snapshot={item.neighborhoodSnapshot} />
          <SourcesPanel citations={item.citations} />
        </div>
      )}
    </article>
  );
}
