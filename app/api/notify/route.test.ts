import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockWhere, mockInnerJoin, mockFrom, mockSelect } = vi.hoisted(() => {
  const mockWhere = vi.fn();
  const mockInnerJoin = vi.fn(() => ({ where: mockWhere }));
  const mockFrom = vi.fn(() => ({ innerJoin: mockInnerJoin }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  return { mockWhere, mockInnerJoin, mockFrom, mockSelect };
});

vi.mock('../../../lib/db/client', () => ({
  db: { select: mockSelect },
}));

import { POST, __resetNotifyRateLimitForTests } from './route';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const sampleRow = {
  societyName: 'Prestige Lakeside Habitat',
  locality: 'Koramangala',
  rent: 35000,
  bedrooms: 2,
  amenities: ['parking', 'gym'],
  sqft: 1100,
};

describe('POST /api/notify', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ innerJoin: mockInnerJoin });
    mockInnerJoin.mockReturnValue({ where: mockWhere });
    process.env.N8N_WEBHOOK_URL = 'https://n8n.example.com/webhook/shortlist-pdf';
    __resetNotifyRateLimitForTests();
  });

  it('sends the shortlist and returns status sent on the happy path', async () => {
    mockWhere.mockResolvedValue([sampleRow]);
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const res = await POST(makeRequest({ sessionId: 'sess-1', email: 'user@example.com' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ status: 'sent' });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://n8n.example.com/webhook/shortlist-pdf',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'sess-1',
          shortlist: [sampleRow],
          email: 'user@example.com',
        }),
      })
    );
  });

  it('returns 400 and does not call the webhook when there are no active shortlist items', async () => {
    mockWhere.mockResolvedValue([]);
    global.fetch = vi.fn();

    const res = await POST(makeRequest({ sessionId: 'sess-empty', email: 'user@example.com' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/no active shortlist/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns 502 when the webhook is unreachable', async () => {
    mockWhere.mockResolvedValue([sampleRow]);
    global.fetch = vi.fn().mockRejectedValue(new Error('network error'));

    const res = await POST(makeRequest({ sessionId: 'sess-1', email: 'user@example.com' }));
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.error).toBeDefined();
  });

  it('returns 502 when the webhook responds with a non-2xx status', async () => {
    mockWhere.mockResolvedValue([sampleRow]);
    global.fetch = vi.fn().mockResolvedValue(new Response('nope', { status: 500 }));

    const res = await POST(makeRequest({ sessionId: 'sess-1', email: 'user@example.com' }));
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.error).toMatch(/500/);
  });

  it('returns 400 for an invalid email and does not query the DB', async () => {
    const res = await POST(makeRequest({ sessionId: 'sess-1', email: 'not-an-email' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBeDefined();
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('returns 400 for a missing sessionId', async () => {
    const res = await POST(makeRequest({ email: 'user@example.com' }));
    expect(res.status).toBe(400);
  });

  it('returns 429 and does not call the webhook on a second request for the same session within the cooldown', async () => {
    mockWhere.mockResolvedValue([sampleRow]);
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const first = await POST(makeRequest({ sessionId: 'sess-rate-limit', email: 'user@example.com' }));
    expect(first.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const second = await POST(makeRequest({ sessionId: 'sess-rate-limit', email: 'attacker@example.com' }));
    const json = await second.json();

    expect(second.status).toBe(429);
    expect(json.error).toMatch(/too many/i);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
