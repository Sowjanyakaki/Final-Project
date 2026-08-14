// @vitest-environment node
// jsdom's Blob/FormData don't resolve arrayBuffer() reliably; this route only
// ever runs server-side, so test it under the real node environment.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockTranscribe, mockTranscriptionModel, mockTranscriptionFactory } = vi.hoisted(() => {
  const mockTranscribe = vi.fn();
  const mockTranscriptionModel = { modelId: 'whisper-large-v3-turbo' };
  const mockTranscriptionFactory = vi.fn(() => mockTranscriptionModel);
  return { mockTranscribe, mockTranscriptionModel, mockTranscriptionFactory };
});

vi.mock('ai', () => ({ transcribe: mockTranscribe }));
vi.mock('@ai-sdk/groq', () => ({ groq: { transcription: mockTranscriptionFactory } }));

import { POST } from './route';

function makeRequest(formData: FormData): Request {
  return new Request('http://localhost/api/stt', { method: 'POST', body: formData });
}

describe('POST /api/stt', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockTranscriptionFactory.mockReturnValue(mockTranscriptionModel);
  });

  it('transcribes the uploaded audio and returns its text', async () => {
    mockTranscribe.mockResolvedValue({ text: 'find a 2bhk in Koramangala', segments: [] });

    const formData = new FormData();
    formData.append('audio', new Blob(['audio-bytes'], { type: 'audio/webm' }), 'recording.webm');

    const res = await POST(makeRequest(formData));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ text: 'find a 2bhk in Koramangala' });
    expect(mockTranscriptionFactory).toHaveBeenCalledWith('whisper-large-v3-turbo');
    expect(mockTranscribe).toHaveBeenCalledWith(
      expect.objectContaining({ model: mockTranscriptionModel, audio: expect.any(Uint8Array) })
    );
  });

  it('returns 400 and does not call transcribe when no audio field is present', async () => {
    const res = await POST(makeRequest(new FormData()));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBeDefined();
    expect(mockTranscribe).not.toHaveBeenCalled();
  });

  it('returns 400 for a request body that is not valid multipart form data', async () => {
    const res = await POST(new Request('http://localhost/api/stt', { method: 'POST', body: '' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBeDefined();
    expect(mockTranscribe).not.toHaveBeenCalled();
  });

  it('returns 502 when transcription fails', async () => {
    mockTranscribe.mockRejectedValue(new Error('groq unavailable'));

    const formData = new FormData();
    formData.append('audio', new Blob(['audio-bytes'], { type: 'audio/webm' }), 'recording.webm');

    const res = await POST(makeRequest(formData));
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.error).toBeDefined();
  });
});
