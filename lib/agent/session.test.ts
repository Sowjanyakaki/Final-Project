import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../db/client';
import { getOrCreateSession } from './session';

vi.mock('../db/client', () => ({
  db: { select: vi.fn(), insert: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getOrCreateSession', () => {
  it('returns the existing session info when the cookie id matches a row', async () => {
    vi.mocked(db.select).mockReturnValue({
      from: () => ({
        where: () => Promise.resolve([{ id: 'sess-existing-1' }]),
      }),
    } as never);

    const result = await getOrCreateSession('sess-existing-1');

    expect(result).toEqual({ id: 'sess-existing-1', isNew: false });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('creates a new session when no cookie id is given', async () => {
    const insertValuesMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValue({ values: insertValuesMock } as never);

    const result = await getOrCreateSession(undefined);

    expect(db.select).not.toHaveBeenCalled();
    expect(insertValuesMock).toHaveBeenCalledTimes(1);
    expect(result.isNew).toBe(true);
    expect(typeof result.id).toBe('string');
    expect(result.id.length).toBeGreaterThan(0);
  });

  it('creates a new session when the cookie id does not match any row', async () => {
    vi.mocked(db.select).mockReturnValue({
      from: () => ({
        where: () => Promise.resolve([]),
      }),
    } as never);
    const insertValuesMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValue({ values: insertValuesMock } as never);

    const result = await getOrCreateSession('stale-cookie-id');

    expect(insertValuesMock).toHaveBeenCalledTimes(1);
    expect(result.isNew).toBe(true);
    expect(result.id).not.toBe('stale-cookie-id');
  });
});
