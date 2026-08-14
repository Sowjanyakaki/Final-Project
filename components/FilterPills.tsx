'use client';

import styles from './FilterPills.module.css';

interface FilterPillsProps {
  bedrooms: number | undefined;
  onBedroomsChange: (bedrooms: number | undefined) => void;
}

const BEDROOM_OPTIONS = [2, 3];

export default function FilterPills({ bedrooms, onBedroomsChange }: FilterPillsProps) {
  return (
    <div className={styles.pills} role="group" aria-label="Filters">
      <span className={styles.pillStatic} data-testid="pill-for-rent">
        For Rent
      </span>
      {BEDROOM_OPTIONS.map((option) => {
        const active = bedrooms === option;
        return (
          <button
            key={option}
            type="button"
            className={active ? styles.pillActive : styles.pill}
            aria-pressed={active}
            data-testid={`pill-${option}bhk`}
            onClick={() => onBedroomsChange(active ? undefined : option)}
          >
            {option} BHK
          </button>
        );
      })}
    </div>
  );
}
