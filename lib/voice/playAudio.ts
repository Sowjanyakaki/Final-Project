/**
 * Plays a TTS response (Blob or URL) and resolves once playback finishes (or
 * errors), so callers can await "done speaking" without managing an Audio
 * element themselves.
 */
export function playAudio(blobOrUrl: Blob | string): Promise<void> {
  const url = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
  const isObjectUrl = typeof blobOrUrl !== 'string';

  return new Promise((resolve, reject) => {
    const audio = new Audio(url);

    const cleanup = () => {
      if (isObjectUrl) URL.revokeObjectURL(url);
    };

    audio.onended = () => {
      cleanup();
      resolve();
    };
    audio.onerror = () => {
      cleanup();
      reject(new Error('Audio playback failed'));
    };

    void audio.play().catch((err) => {
      cleanup();
      reject(err);
    });
  });
}
