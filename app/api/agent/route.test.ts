import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetOrCreateSession } = vi.hoisted(() => ({
  mockGetOrCreateSession: vi.fn(),
}));
const { mockCreateAgent } = vi.hoisted(() => ({
  mockCreateAgent: vi.fn(),
}));
const { mockCookieGet, mockCookieSet, mockCookies } = vi.hoisted(() => {
  const mockCookieGet = vi.fn();
  const mockCookieSet = vi.fn();
  const mockCookies = vi.fn(() => Promise.resolve({ get: mockCookieGet, set: mockCookieSet }));
  return { mockCookieGet, mockCookieSet, mockCookies };
});

vi.mock('../../../lib/agent/session', () => ({ getOrCreateSession: mockGetOrCreateSession }));
vi.mock('../../../lib/agent/orchestrator', () => ({ createAgent: mockCreateAgent }));
vi.mock('next/headers', () => ({ cookies: mockCookies }));

import { POST, SESSION_COOKIE_NAME } from './route';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/agent', () => {
  const mockStream = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    mockCookies.mockReturnValue(Promise.resolve({ get: mockCookieGet, set: mockCookieSet }));
    mockCookieGet.mockReturnValue(undefined);
    mockStream.mockReturnValue({
      toTextStreamResponse: () => new Response('Here are 3 matching listings.', { status: 200 }),
    });
    mockCreateAgent.mockReturnValue({ stream: mockStream });
  });

  it('creates a new session when no cookie is present, streams a reply, and sets the session cookie', async () => {
    mockGetOrCreateSession.mockResolvedValue({ id: 'sess-new', isNew: true });

    const res = await POST(makeRequest({ message: 'find a 2bhk in Koramangala' }));
    const text = await res.text();

    expect(mockGetOrCreateSession).toHaveBeenCalledWith(undefined);
    expect(mockCreateAgent).toHaveBeenCalledWith('sess-new');
    expect(mockStream).toHaveBeenCalledWith([{ role: 'user', content: 'find a 2bhk in Koramangala' }]);
    expect(text).toBe('Here are 3 matching listings.');
    expect(mockCookieSet).toHaveBeenCalledWith(
      SESSION_COOKIE_NAME,
      'sess-new',
      expect.objectContaining({ httpOnly: true, path: '/' })
    );
  });

  it('reuses the session id from an existing cookie', async () => {
    mockCookieGet.mockReturnValue({ value: 'sess-existing' });
    mockGetOrCreateSession.mockResolvedValue({ id: 'sess-existing', isNew: false });

    await POST(makeRequest({ message: 'any 1bhk under 30k?' }));

    expect(mockCookieGet).toHaveBeenCalledWith(SESSION_COOKIE_NAME);
    expect(mockGetOrCreateSession).toHaveBeenCalledWith('sess-existing');
    expect(mockCreateAgent).toHaveBeenCalledWith('sess-existing');
  });

  it('returns 400 and does not call the agent for a missing message', async () => {
    const res = await POST(makeRequest({}));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBeDefined();
    expect(mockCreateAgent).not.toHaveBeenCalled();
  });

  it('returns 400 and does not call the agent for an empty message', async () => {
    const res = await POST(makeRequest({ message: '   ' }));

    expect(res.status).toBe(400);
    expect(mockCreateAgent).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid JSON', async () => {
    const res = await POST(
      new Request('http://localhost/api/agent', { method: 'POST', body: 'not json' })
    );

    expect(res.status).toBe(400);
    expect(mockCreateAgent).not.toHaveBeenCalled();
  });
});
