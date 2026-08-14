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
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => resolve();
    utterance.onerror = () => reject(new Error('Speech synthesis failed'));
    speechSynthesis.speak(utterance);
  });
}
