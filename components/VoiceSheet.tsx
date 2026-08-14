'use client';

import styles from './VoiceSheet.module.css';
import VoiceBar from './VoiceBar';

interface VoiceSheetProps {
  open: boolean;
  onClose: () => void;
}

export default function VoiceSheet({ open, onClose }: VoiceSheetProps) {
  if (!open) return null;

  return (
    <div className={styles.backdrop} data-testid="voice-sheet-backdrop" onClick={onClose}>
      <div
        className={styles.sheet}
        data-testid="voice-sheet"
        role="dialog"
        aria-label="Voice assistant"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className={styles.closeButton} aria-label="Close voice assistant" onClick={onClose}>
          ×
        </button>
        <VoiceBar />
      </div>
    </div>
  );
}
