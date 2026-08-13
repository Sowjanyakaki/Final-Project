import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chunkText, wikipediaApiUrl, fetchLocalityPage, ingestLocality } from './ingest-neighborhood-docs';
import { neighborhoodDocs } from '../lib/db/schema';

describe('chunkText', () => {
  it('returns an empty array for empty or whitespace-only text', () => {
    expect(chunkText('', 500)).toEqual([]);
    expect(chunkText('   \n\t  ', 500)).toEqual([]);
  });

  it('returns a single chunk for text shorter than the target size', () => {
    const shortText = Array.from({ length: 12 }, (_, i) => `word${i}`).join(' ');
    const chunks = chunkText(shortText, 500);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(shortText);
  });

  it('splits long text into multiple chunks of approximately the target word count', () => {
    const longText = Array.from({ length: 1250 }, (_, i) => `word${i}`).join(' ');
    const chunks = chunkText(longText, 500);

    expect(chunks).toHaveLength(3);
    expect(chunks[0].split(' ')).toHaveLength(500);
    expect(chunks[1].split(' ')).toHaveLength(500);
    expect(chunks[2].split(' ')).toHaveLength(250);
    expect(chunks.join(' ')).toBe(longText);
  });

  it('defaults targetTokens to 500 when omitted', () => {
    const longText = Array.from({ length: 600 }, (_, i) => `word${i}`).join(' ');
    const chunks = chunkText(longText);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].split(' ')).toHaveLength(500);
  });
});

describe('wikipediaApiUrl', () => {
  it('includes the locality as titles and requests plain-text extracts', () => {
    const url = wikipediaApiUrl('Koramangala');
    expect(url).toContain('titles=Koramangala');
    expect(url).toContain('explaintext=1');
    expect(url).toContain('action=query');
  });
});

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe('fetchLocalityPage', () => {
  it('extracts title, canonical URL, and plain-text extract from the Wikipedia API response', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        query: {
          pages: {
            '12345': {
              pageid: 12345,
              title: 'Koramangala',
              extract: 'Koramangala is a neighbourhood in Bengaluru, India.',
            },
          },
        },
      })
    );

    const result = await fetchLocalityPage('Koramangala', fetchFn);

    expect(fetchFn).toHaveBeenCalledWith(expect.stringContaining('titles=Koramangala'));
    expect(result).toEqual({
      title: 'Koramangala',
      url: 'https://en.wikipedia.org/wiki/Koramangala',
      text: 'Koramangala is a neighbourhood in Bengaluru, India.',
    });
  });

  it('returns empty text for a missing Wikipedia page instead of throwing', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        query: {
          pages: {
            '-1': { ns: 0, title: 'Some Nonexistent Place', missing: '' },
          },
        },
      })
    );

    const result = await fetchLocalityPage('Some Nonexistent Place', fetchFn);
    expect(result.text).toBe('');
  });

  it('throws when the HTTP request fails', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, false, 503));
    await expect(fetchLocalityPage('Koramangala', fetchFn)).rejects.toThrow(/503/);
  });
});

describe('ingestLocality', () => {
  function makeMockDb() {
    const whereMock = vi.fn().mockResolvedValue(undefined);
    const deleteMock = vi.fn(() => ({ where: whereMock }));
    const valuesMock = vi.fn().mockResolvedValue(undefined);
    const insertMock = vi.fn(() => ({ values: valuesMock }));
    return { delete: deleteMock, insert: insertMock, whereMock, valuesMock, deleteMock, insertMock };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears existing rows for the locality, chunks the fetched text, embeds each chunk, and inserts mapped rows', async () => {
    const longExtract = Array.from({ length: 600 }, (_, i) => `word${i}`).join(' ');
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        query: {
          pages: {
            '1': { title: 'Koramangala', extract: longExtract },
          },
        },
      }),
    });
    const embed = vi.fn().mockResolvedValue(new Array(384).fill(0.42));
    const mockDb = makeMockDb();

    const count = await ingestLocality('Koramangala', {
      fetchFn: fetchFn as unknown as typeof fetch,
      embed,
      dbClient: mockDb as unknown as Parameters<typeof ingestLocality>[1] extends { dbClient?: infer D } ? D : never,
      targetTokens: 500,
    });

    expect(count).toBe(2);
    expect(mockDb.deleteMock).toHaveBeenCalledWith(neighborhoodDocs);
    expect(mockDb.whereMock).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledTimes(2);
    expect(mockDb.insertMock).toHaveBeenCalledWith(neighborhoodDocs);

    const insertedRows = mockDb.valuesMock.mock.calls[0][0];
    expect(insertedRows).toHaveLength(2);
    expect(insertedRows[0]).toMatchObject({
      locality: 'Koramangala',
      sourceTitle: 'Koramangala',
      sourceUrl: 'https://en.wikipedia.org/wiki/Koramangala',
      embedding: new Array(384).fill(0.42),
    });
    expect(insertedRows[0].chunkText.split(' ')).toHaveLength(500);
    expect(insertedRows[0].fetchedAt).toBeInstanceOf(Date);
  });

  it('still clears old rows but does not insert or embed when the fetched text is empty', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ query: { pages: { '-1': { title: 'Ghost Town', missing: '' } } } }),
    });
    const embed = vi.fn();
    const mockDb = makeMockDb();

    const count = await ingestLocality('Ghost Town', {
      fetchFn: fetchFn as unknown as typeof fetch,
      embed,
      dbClient: mockDb as unknown as Parameters<typeof ingestLocality>[1] extends { dbClient?: infer D } ? D : never,
    });

    expect(count).toBe(0);
    expect(mockDb.deleteMock).toHaveBeenCalledWith(neighborhoodDocs);
    expect(embed).not.toHaveBeenCalled();
    expect(mockDb.insertMock).not.toHaveBeenCalled();
  });
});
