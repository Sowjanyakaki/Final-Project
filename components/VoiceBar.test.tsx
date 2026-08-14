import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import VoiceBar from './VoiceBar';
import { useVoiceRecorder } from '../lib/voice/useVoiceRecorder';
import { speak } from '../lib/voice/speak';

vi.mock('../lib/voice/useVoiceRecorder', () => ({
  useVoiceRecorder: vi.fn(),
}));
vi.mock('../lib/voice/speak', () => ({
  speak: vi.fn(),
}));

describe('VoiceBar', () => {
  const startMock = vi.fn();
  const stopMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useVoiceRecorder).mockReturnValue({
      isRecording: false,
      start: startMock,
      stop: stopMock,
    });
    vi.mocked(speak).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts recording on first click, then stops, transcribes, and shows the agent reply on second click', async () => {
    const blob = new Blob(['audio-bytes'], { type: 'audio/webm' });
    stopMock.mockResolvedValue(blob);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ text: 'find a 2bhk in Koramangala' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => 'Here are 3 matching listings.',
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<VoiceBar />);

    fireEvent.click(screen.getByRole('button', { name: /start recording/i }));
    expect(startMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /stop recording/i }));
    expect(stopMock).toHaveBeenCalledTimes(1);

    await waitFor(() =>
      expect(screen.getByTestId('transcript')).toHaveTextContent('find a 2bhk in Koramangala')
    );

    await waitFor(() =>
      expect(screen.getByTestId('agent-reply')).toHaveTextContent('Here are 3 matching listings.')
    );

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/stt', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/agent',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ message: 'find a 2bhk in Koramangala' }),
      })
    );

    await waitFor(() => expect(speak).toHaveBeenCalledWith('Here are 3 matching listings.'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
