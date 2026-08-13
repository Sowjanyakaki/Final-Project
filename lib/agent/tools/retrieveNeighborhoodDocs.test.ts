import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../../db/client';
import { embedText } from '../../rag/embed';
import { retrieveNeighborhoodDocs } from './retrieveNeighborhoodDocs';

vi.mock('../../db/client', () => ({
  db: { select: vi.fn() },
}));

vi.mock('../../rag/embed', () => ({
  embedText: vi.fn(),
}));

function mockDbRows(rows: unknown[]) {
  vi.mocked(db.select).mockReturnValue({
    from: () => ({
      where: () => Promise.resolve(rows),
    }),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(embedText).mockResolvedValue([1, 0, 0]);
});

describe('retrieveNeighborhoodDocs', () => {
  it('returns grounded chunks with citations when rows are found, ranked by similarity to the query', async () => {
    const rows = [
      {
        chunkText: 'Koramangala has good metro connectivity.',
        sourceTitle: 'Koramangala - Wikipedia',
        sourceUrl: 'https://en.wikipedia.org/wiki/Koramangala',
        embedding: [0, 1, 0], // orthogonal to query — least similar
      },
      {
        chunkText: 'The area is considered safe with active street life at night.',
        sourceTitle: 'Bengaluru neighborhood guide',
        sourceUrl: 'https://example.com/guide',
        embedding: [1, 0, 0], // identical to query — most similar
      },
    ];
    mockDbRows(rows);

    const result = await retrieveNeighborhoodDocs({ locality: 'Koramangala', topic: 'safety at night' });

    expect(embedText).toHaveBeenCalledWith('safety at night');
    expect(result.uncertain).toBe(false);
    // Most-similar row (identical embedding) ranked first.
    expect(result.chunks).toEqual([
      {
        chunkText: 'The area is considered safe with active street life at night.',
        sourceTitle: 'Bengaluru neighborhood guide',
        sourceUrl: 'https://example.com/guide',
      },
      {
        chunkText: 'Koramangala has good metro connectivity.',
        sourceTitle: 'Koramangala - Wikipedia',
        sourceUrl: 'https://en.wikipedia.org/wiki/Koramangala',
      },
    ]);
  });

  it('caps results at the top 3 most-similar chunks', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      chunkText: `chunk ${i}`,
      sourceTitle: 'Some Guide',
      sourceUrl: 'https://example.com/guide',
      embedding: [1, 0, 0],
    }));
    mockDbRows(rows);

    const result = await retrieveNeighborhoodDocs({ locality: 'Koramangala', topic: 'transit' });
    expect(result.chunks).toHaveLength(3);
  });

  it('returns uncertain:true and no chunks when zero rows are found', async () => {
    mockDbRows([]);

    const result = await retrieveNeighborhoodDocs({ locality: 'Koramangala', topic: 'safety at night' });

    expect(result).toEqual({ chunks: [], uncertain: true });
  });

  it('returns uncertain:true for a locality with no matching docs (e.g. a typo)', async () => {
    mockDbRows([]);

    const result = await retrieveNeighborhoodDocs({ locality: 'Koramangla', topic: 'transit' });

    expect(result).toEqual({ chunks: [], uncertain: true });
  });
});
