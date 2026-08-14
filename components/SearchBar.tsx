'use client';

import { useRef, useState } from 'react';
import styles from './SearchBar.module.css';
import { SearchIcon } from './icons/icons';

interface SearchBarProps {
  defaultValue?: string;
  onChange: (value: string) => void;
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 300;

export default function SearchBar({ defaultValue = '', onChange, debounceMs = DEFAULT_DEBOUNCE_MS }: SearchBarProps) {
  const [draft, setDraft] = useState(defaultValue);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function handleInput(next: string) {
    setDraft(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onChange(next), debounceMs);
  }

  return (
    <div className={styles.searchBar}>
      <SearchIcon className={styles.icon} />
      <input
        type="text"
        aria-label="Enter an area to find flats"
        placeholder="Enter an area to find flats"
        value={draft}
        onChange={(e) => handleInput(e.target.value)}
        className={styles.input}
      />
    </div>
  );
}
