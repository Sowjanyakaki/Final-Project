/**
 * Strips markdown formatting the model tends to emit (bold, bullets,
 * headers, links, code) so SpeechSynthesis doesn't read the literal
 * punctuation aloud (e.g. "asterisk asterisk Green Meadows asterisk
 * asterisk"). The UI still renders the original text verbatim — this
 * only affects what gets spoken.
 */
export function stripMarkdownForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^ {0,3}#{1,6}\s+/gm, '')
    .replace(/^ {0,3}[*+-]\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/[*_#`]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * Speaks text via the browser's native SpeechSynthesis API, resolving once
 * speech ends. Groq's TTS model (playai-tts) is fully retired (shut down
 * 2025-12-31) and its replacement is a preview-only model not fit for
 * production, so this is the documented ARCHITECTURE.md fallback rather
 * than a stopgap: no server round-trip, works entirely client-side.
 */
export function speak(text: string): Promise<void> {
  if (typeof speechSynthesis === 'undefined' || !speechSynthesis) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    // A known Chrome bug leaves an utterance stuck in the speech queue
    // (e.g. after a fast-navigating or interrupted prior turn), which
    // silently swallows every subsequent speak() call with no error.
    // Clearing the queue first keeps voice output from randomly going
    // silent turn to turn.
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(stripMarkdownForSpeech(text));
    utterance.onend = () => resolve();
    utterance.onerror = () => reject(new Error('Speech synthesis failed'));
    speechSynthesis.speak(utterance);
  });
}
