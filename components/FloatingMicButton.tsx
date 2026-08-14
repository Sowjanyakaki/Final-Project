'use client';

import styles from './FloatingMicButton.module.css';
import { MicIcon } from './icons/icons';

interface FloatingMicButtonProps {
  onClick: () => void;
}

export default function FloatingMicButton({ onClick }: FloatingMicButtonProps) {
  return (
    <button
      type="button"
      className={styles.button}
      aria-label="Open voice assistant"
      onClick={onClick}
      data-testid="floating-mic-button"
    >
      <MicIcon />
    </button>
  );
}
