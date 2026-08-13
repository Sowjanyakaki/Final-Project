import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../../db/client';
import { searchListings } from './searchListings';
import { applyShortlistEdit } from './applyShortlistEdit';

vi.mock('../../db/client', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
  },
}));

vi.mock('./searchListings', () => ({
  searchListings: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.insert).mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) } as never);
});

function mockSelectOnce(rows: unknown[]) {
  vi.mocked(db.select).mockReturnValueOnce({
    from: () => ({
      innerJoin: () => ({
        where: () => Promise.resolve(rows),
      }),
      where: () => Promise.resolve(rows),
    }),
  } as never);
}

describe('applyShortlistEdit — filter op (scope discipline)', () => {
  it('flips exactly the over-budget items to dropped and leaves the other 3 byte-for-byte unchanged', async () => {
    const rows = [
      { shortlistItemId: 1, listingId: 1, rent: 30000, bedrooms: 2 },
      { shortlistItemId: 2, listingId: 2, rent: 45000, bedrooms: 2 }, // over budget
      { shortlistItemId: 3, listingId: 3, rent: 38000, bedrooms: 2 },
      { shortlistItemId: 4, listingId: 4, rent: 52000, bedrooms: 3 }, // over budget
      { shortlistItemId: 5, listingId: 5, rent: 25000, bedrooms: 1 },
    ];
    mockSelectOnce(rows);

    const updateSetMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    vi.mocked(db.update).mockReturnValue({ set: updateSetMock } as never);

    const diff = await applyShortlistEdit({
      sessionId: 'sess-1',
      editIntent: { op: 'filter', field: 'rent', comparator: '<=', value: 40000 },
    });

    expect(diff.changed.slice().sort()).toEqual([2, 4]);
    expect(diff.unchanged.slice().sort()).toEqual([1, 3, 5]);
    // Exactly 2 update calls issued — the other 3 rows were never written to.
    expect(db.update).toHaveBeenCalledTimes(2);
    expect(updateSetMock).toHaveBeenCalledTimes(2);
    for (const call of updateSetMock.mock.calls) {
      expect(call[0]).toMatchObject({ status: 'dropped' });
      expect(typeof call[0].reason).toBe('string');
    }
  });

  it('logs exactly one toolCallLog row with the tool name, input, and output', async () => {
    mockSelectOnce([{ shortlistItemId: 1, listingId: 1, rent: 45000, bedrooms: 2 }]);
    vi.mocked(db.update).mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) } as never);
    const insertValuesMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValue({ values: insertValuesMock } as never);

    const editIntent = { op: 'filter' as const, field: 'rent' as const, comparator: '<=' as const, value: 40000 };
    const diff = await applyShortlistEdit({ sessionId: 'sess-1', editIntent });

    expect(insertValuesMock).toHaveBeenCalledTimes(1);
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'sess-1', toolName: 'applyShortlistEdit', input: editIntent, output: diff })
    );
  });
});

describe('applyShortlistEdit — remove op', () => {
  it('drops only the targeted listingId', async () => {
    mockSelectOnce([
      { shortlistItemId: 1, listingId: 1 },
      { shortlistItemId: 2, listingId: 2 },
      { shortlistItemId: 3, listingId: 3 },
    ]);
    const updateSetMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    vi.mocked(db.update).mockReturnValue({ set: updateSetMock } as never);

    const diff = await applyShortlistEdit({ sessionId: 'sess-1', editIntent: { op: 'remove', listingId: 2 } });

    expect(diff.changed).toEqual([2]);
    expect(diff.unchanged.slice().sort()).toEqual([1, 3]);
    expect(db.update).toHaveBeenCalledTimes(1);
  });
});

describe('applyShortlistEdit — add op', () => {
  it('inserts only results not already in the shortlist', async () => {
    mockSelectOnce([{ listingId: 1 }, { listingId: 2 }]); // existing active items
    vi.mocked(searchListings).mockResolvedValue([
      { id: 1 } as never, // already present — must not be re-inserted
      { id: 3 } as never, // new — must be inserted
    ]);
    const insertValuesMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValue({ values: insertValuesMock } as never);

    const diff = await applyShortlistEdit({
      sessionId: 'sess-1',
      editIntent: { op: 'add', filters: { mustHaves: ['balcony'] } },
    });

    expect(searchListings).toHaveBeenCalledWith({ mustHaves: ['balcony'] });
    expect(diff.changed).toEqual([3]);
    expect(diff.unchanged.slice().sort()).toEqual([1, 2]);
    // One insert for the new shortlist row, one insert for the toolCallLog row.
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'sess-1', listingId: 3, status: 'active' })
    );
  });
});
