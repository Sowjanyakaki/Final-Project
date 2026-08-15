import { describe, it, expect, vi, beforeEach } from 'vitest';
import { streamText } from 'ai';
import { db } from '../db/client';
import { searchListings } from './tools/searchListings';
import { retrieveNeighborhoodDocs } from './tools/retrieveNeighborhoodDocs';
import { applyShortlistEdit } from './tools/applyShortlistEdit';
import { osmNearby } from './tools/osmNearby';
import { listBookingSlots } from './tools/listBookingSlots';
import { createBookingHold } from './tools/createBookingHold';
import { createAgent, SYSTEM_PROMPT } from './orchestrator';

vi.mock('../db/client', () => ({
  db: { insert: vi.fn() },
}));

vi.mock('ai', () => ({
  streamText: vi.fn(),
  stepCountIs: vi.fn((n: number) => n),
  // Identity passthrough so tests can call tools[...].execute(...) directly
  // without depending on the real AI SDK's schema-validation internals.
  tool: vi.fn((config: unknown) => config),
}));

vi.mock('@ai-sdk/groq', () => ({
  groq: vi.fn((modelId: string) => ({ modelId })),
}));

vi.mock('./tools/searchListings', () => ({ searchListings: vi.fn().mockResolvedValue([]) }));
vi.mock('./tools/retrieveNeighborhoodDocs', () => ({
  retrieveNeighborhoodDocs: vi.fn().mockResolvedValue({ chunks: [], uncertain: true }),
}));
vi.mock('./tools/applyShortlistEdit', () => ({ applyShortlistEdit: vi.fn().mockResolvedValue({ changed: [], unchanged: [] }) }));
vi.mock('./tools/osmNearby', () => ({ osmNearby: vi.fn().mockResolvedValue({ items: [], uncertain: true }) }));
vi.mock('./tools/listBookingSlots', () => ({ listBookingSlots: vi.fn().mockResolvedValue({ slots: [] }) }));
vi.mock('./tools/createBookingHold', () => ({
  createBookingHold: vi.fn().mockResolvedValue({ confirmationCode: 'NL-0001', holdId: 'hold-1', status: 'tentative' }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.insert).mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) } as never);
});

describe('createAgent', () => {
  it('registers all 6 tools under the expected names', () => {
    const agent = createAgent('sess-1');
    expect(Object.keys(agent.tools).sort()).toEqual(
      ['applyShortlistEdit', 'createBookingHold', 'listBookingSlots', 'osmNearby', 'retrieveNeighborhoodDocs', 'searchListings'].sort()
    );
  });

  it('system prompt enforces the max-5-questions rule and grounding-uncertainty rule', () => {
    expect(SYSTEM_PROMPT).toMatch(/at most 5 clarifying questions/i);
    expect(SYSTEM_PROMPT).toMatch(/uncertain/i);
    expect(SYSTEM_PROMPT).toMatch(/osmNearby|retrieveNeighborhoodDocs/);
  });

  it('wraps searchListings so invoking it writes a toolCallLog row via db.insert', async () => {
    const insertValuesMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValue({ values: insertValuesMock } as never);

    const agent = createAgent('sess-1');
    const searchTool = agent.tools.searchListings as unknown as { execute: (input: unknown) => Promise<unknown> };
    await searchTool.execute({ budgetMax: 40000 });

    expect(searchListings).toHaveBeenCalledWith({ budgetMax: 40000 });
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'sess-1', toolName: 'searchListings' })
    );
  });

  it('wraps applyShortlistEdit so it binds sessionId and writes a toolCallLog row', async () => {
    const insertValuesMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValue({ values: insertValuesMock } as never);

    const agent = createAgent('sess-42');
    const editTool = agent.tools.applyShortlistEdit as unknown as { execute: (input: unknown) => Promise<unknown> };
    const editIntent = { op: 'remove' as const, listingId: 1 };
    await editTool.execute({ editIntent });

    expect(applyShortlistEdit).toHaveBeenCalledWith({ sessionId: 'sess-42', editIntent });
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'sess-42', toolName: 'applyShortlistEdit' })
    );
  });

  it('wraps osmNearby, listBookingSlots, and createBookingHold with the same logging behavior', async () => {
    const insertValuesMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValue({ values: insertValuesMock } as never);

    const agent = createAgent('sess-1');
    const osmTool = agent.tools.osmNearby as unknown as { execute: (input: unknown) => Promise<unknown> };
    await osmTool.execute({ lat: 12.9, lng: 77.6, category: 'metro_station' });
    expect(osmNearby).toHaveBeenCalledWith({ lat: 12.9, lng: 77.6, category: 'metro_station' });

    const slotsTool = agent.tools.listBookingSlots as unknown as { execute: (input: unknown) => Promise<unknown> };
    await slotsTool.execute({ dayPreference: 'weekday', timePreference: 'evening' });
    expect(listBookingSlots).toHaveBeenCalledWith({ dayPreference: 'weekday', timePreference: 'evening' });

    const holdTool = agent.tools.createBookingHold as unknown as { execute: (input: unknown) => Promise<unknown> };
    const slot = { id: 's-1', startIso: '2026-08-10T10:00:00Z', label: 'Mon 10:00 AM' };
    await holdTool.execute({ listingId: 1, topic: 'Alpha Society, Koramangala', slot });
    expect(createBookingHold).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      listingId: '1',
      topic: 'Alpha Society, Koramangala',
      slot,
    });

    expect(insertValuesMock).toHaveBeenCalledTimes(3);
  });

  it('forwards an onFinish callback to streamText, so a caller can persist the final reply once streaming ends', () => {
    const agent = createAgent('sess-1');
    const onFinish = vi.fn();

    agent.stream([{ role: 'user', content: 'hi' }], { onFinish });

    expect(streamText).toHaveBeenCalledWith(expect.objectContaining({ onFinish }));
  });

  it('does not blow up when stream is called without an onFinish callback', () => {
    const agent = createAgent('sess-1');

    expect(() => agent.stream([{ role: 'user', content: 'hi' }])).not.toThrow();
  });
});
