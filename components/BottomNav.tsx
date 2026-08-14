'use client';

import styles from './BottomNav.module.css';
import { HouseIcon, HeartIcon, MicIcon, PersonIcon } from './icons/icons';

interface BottomNavProps {
  onOpenVoice: () => void;
}

export default function BottomNav({ onOpenVoice }: BottomNavProps) {
  return (
    <nav className={styles.nav} aria-label="Primary" data-testid="bottom-nav">
      <button type="button" className={styles.itemActive} aria-current="page">
        <HouseIcon />
        <span>Explore</span>
      </button>
      <button type="button" className={styles.item} disabled>
        <HeartIcon />
        <span>Saved</span>
      </button>
      <button type="button" className={styles.item} onClick={onOpenVoice}>
        <MicIcon />
        <span>AI Scout</span>
      </button>
      <button type="button" className={styles.item} disabled>
        <PersonIcon />
        <span>Profile</span>
      </button>
    </nav>
  );
}
