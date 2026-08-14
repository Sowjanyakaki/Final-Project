import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { speak } from './speak';

describe('speak', () => {
  let utteranceInstances: Array<{ text: string; onend: (() => void) | null; onerror: (() => void) | null }>;
  let speakMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    utteranceInstances = [];
    speakMock = vi.fn();

    class FakeUtterance {
      text: string;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(text: string) {
        this.text = text;
        utteranceInstances.push(this);
      }
    }

    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    vi.stubGlobal('speechSynthesis', { speak: speakMock });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('speaks the given text and resolves when speech ends', async () => {
    const promise = speak('Here are 3 matching listings.');

    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(utteranceInstances).toHaveLength(1);
    expect(utteranceInstances[0].text).toBe('Here are 3 matching listings.');

    utteranceInstances[0].onend?.();
    await expect(promise).resolves.toBeUndefined();
  });

  it('rejects when speech synthesis errors', async () => {
    const promise = speak('Here are 3 matching listings.');

    utteranceInstances[0].onerror?.();
    await expect(promise).rejects.toThrow('Speech synthesis failed');
  });

  it('resolves immediately when speechSynthesis is unavailable in this browser', async () => {
    vi.stubGlobal('speechSynthesis', undefined);

    await expect(speak('Here are 3 matching listings.')).resolves.toBeUndefined();
    expect(speakMock).not.toHaveBeenCalled();
  });
});
