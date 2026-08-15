import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../db/client';
import { getConversationHistory, appendMessage } from './messages';

vi.mock('../db/client', () => ({
  db: { select: vi.fn(), insert: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getConversationHistory', () => {
  it('returns prior messages in chronological order as ModelMessage-shaped objects', async () => {
    const orderByMock = vi.fn().mockResolvedValue([
      { role: 'user', content: 'find a 2bhk' },
      { role: 'assistant', content: 'Sure — what is your budget?' },
    ]);
    vi.mocked(db.select).mockReturnValue({
      from: () => ({ where: () => ({ orderBy: orderByMock }) }),
    } as never);

    const result = await getConversationHistory('sess-1');

    expect(result).toEqual([
      { role: 'user', content: 'find a 2bhk' },
      { role: 'assistant', content: 'Sure — what is your budget?' },
    ]);
  });

  it('returns an empty array for a session with no prior messages', async () => {
    vi.mocked(db.select).mockReturnValue({
      from: () => ({ where: () => ({ orderBy: vi.fn().mockResolvedValue([]) }) }),
    } as never);

    const result = await getConversationHistory('sess-new');

    expect(result).toEqual([]);
  });
});

describe('appendMessage', () => {
  it('inserts a message row with the session id, role, and content', async () => {
    const valuesMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValue({ values: valuesMock } as never);

    await appendMessage('sess-1', 'user', 'find a 2bhk');

    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'sess-1', role: 'user', content: 'find a 2bhk' })
    );
  });

  it('does nothing for empty content, so an empty assistant reply never gets stored', async () => {
    const valuesMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValue({ values: valuesMock } as never);

    await appendMessage('sess-1', 'assistant', '');

    expect(valuesMock).not.toHaveBeenCalled();
  });
});
