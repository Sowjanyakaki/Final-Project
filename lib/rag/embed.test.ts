import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@xenova/transformers', () => ({
  pipeline: vi.fn(),
}));

describe('embedText', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('calls the feature-extraction pipeline with the MiniLM model, mean pooling and normalization', async () => {
    const fakeData = new Float32Array(384).fill(0.5);
    const fakeExtractor = vi.fn().mockResolvedValue({ data: fakeData });
    const { pipeline } = await import('@xenova/transformers');
    (pipeline as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(fakeExtractor);

    const { embedText } = await import('./embed');
    const result = await embedText('Koramangala is a vibrant neighborhood.');

    expect(pipeline).toHaveBeenCalledWith('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    expect(fakeExtractor).toHaveBeenCalledWith('Koramangala is a vibrant neighborhood.', {
      pooling: 'mean',
      normalize: true,
    });
    expect(result).toHaveLength(384);
    expect(result[0]).toBeCloseTo(0.5);
  });

  it('reuses a single cached pipeline instance across multiple calls', async () => {
    const fakeData = new Float32Array(384).fill(0.1);
    const fakeExtractor = vi.fn().mockResolvedValue({ data: fakeData });
    const { pipeline } = await import('@xenova/transformers');
    (pipeline as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(fakeExtractor);

    const { embedText } = await import('./embed');
    await embedText('first chunk');
    await embedText('second chunk');

    expect(pipeline).toHaveBeenCalledTimes(1);
    expect(fakeExtractor).toHaveBeenCalledTimes(2);
  });

  it('truncates output longer than 384 dims', async () => {
    const fakeData = new Float32Array(400).fill(0.2);
    const fakeExtractor = vi.fn().mockResolvedValue({ data: fakeData });
    const { pipeline } = await import('@xenova/transformers');
    (pipeline as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(fakeExtractor);

    const { embedText } = await import('./embed');
    const result = await embedText('long output');

    expect(result).toHaveLength(384);
  });

  it('zero-pads output shorter than 384 dims', async () => {
    const fakeData = new Float32Array(300).fill(0.3);
    const fakeExtractor = vi.fn().mockResolvedValue({ data: fakeData });
    const { pipeline } = await import('@xenova/transformers');
    (pipeline as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(fakeExtractor);

    const { embedText } = await import('./embed');
    const result = await embedText('short output');

    expect(result).toHaveLength(384);
    expect(result[299]).toBeCloseTo(0.3);
    expect(result[300]).toBe(0);
    expect(result[383]).toBe(0);
  });
});
