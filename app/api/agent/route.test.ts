import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetOrCreateSession } = vi.hoisted(() => ({
  mockGetOrCreateSession: vi.fn(),
}));
const { mockCreateAgent } = vi.hoisted(() => ({
  mockCreateAgent: vi.fn(),
}));
const { mockGetConversationHistory, mockAppendMessage } = vi.hoisted(() => ({
  mockGetConversationHistory: vi.fn(),
  mockAppendMessage: vi.fn(),
}));
const { mockCookieGet, mockCookieSet, mockCookies } = vi.hoisted(() => {
  const mockCookieGet = vi.fn();
  const mockCookieSet = vi.fn();
  const mockCookies = vi.fn(() => Promise.resolve({ get: mockCookieGet, set: mockCookieSet }));
  return { mockCookieGet, mockCookieSet, mockCookies };
});

vi.mock('../../../lib/agent/session', () => ({ getOrCreateSession: mockGetOrCreateSession }));
vi.mock('../../../lib/agent/orchestrator', () => ({ createAgent: mockCreateAgent }));
vi.mock('../../../lib/agent/messages', () => ({
  getConversationHistory: mockGetConversationHistory,
  appendMessage: mockAppendMessage,
}));
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
    mockGetConversationHistory.mockResolvedValue([]);
    mockAppendMessage.mockResolvedValue(undefined);
    mockStream.mockReturnValue({
      text: Promise.resolve('Here are 3 matching listings.'),
    });
    mockCreateAgent.mockReturnValue({ stream: mockStream });
  });

  it('creates a new session when no cookie is present, streams a reply, and sets the session cookie', async () => {
    mockGetOrCreateSession.mockResolvedValue({ id: 'sess-new', isNew: true });

    const res = await POST(makeRequest({ message: 'find a 2bhk in Koramangala' }));
    const text = await res.text();

    expect(mockGetOrCreateSession).toHaveBeenCalledWith(undefined);
    expect(mockCreateAgent).toHaveBeenCalledWith('sess-new');
    expect(mockStream).toHaveBeenCalledWith(
      [{ role: 'user', content: 'find a 2bhk in Koramangala' }],
      expect.objectContaining({ onFinish: expect.any(Function) })
    );
    expect(text).toBe('Here are 3 matching listings.');
    expect(mockCookieSet).toHaveBeenCalledWith(
      SESSION_COOKIE_NAME,
      'sess-new',
      expect.objectContaining({ httpOnly: true, path: '/' })
    );
  });

  it("persists the user's message before streaming, using prior conversation history so the model has memory across turns", async () => {
    mockGetOrCreateSession.mockResolvedValue({ id: 'sess-1', isNew: false });
    mockGetConversationHistory.mockResolvedValue([
      { role: 'user', content: 'find a 2bhk in Koramangala' },
      { role: 'assistant', content: 'Got it — what is your budget?' },
    ]);

    await POST(makeRequest({ message: '40000' }));

    expect(mockGetConversationHistory).toHaveBeenCalledWith('sess-1');
    expect(mockStream).toHaveBeenCalledWith(
      [
        { role: 'user', content: 'find a 2bhk in Koramangala' },
        { role: 'assistant', content: 'Got it — what is your budget?' },
        { role: 'user', content: '40000' },
      ],
      expect.anything()
    );
    expect(mockAppendMessage).toHaveBeenCalledWith('sess-1', 'user', '40000');
  });

  it("persists the assistant's final reply via the onFinish callback once the stream completes", async () => {
    mockGetOrCreateSession.mockResolvedValue({ id: 'sess-1', isNew: false });

    await POST(makeRequest({ message: 'find a 2bhk in Koramangala' }));

    const onFinish = mockStream.mock.calls[0][1].onFinish;
    await onFinish({ text: 'Here are 3 matching listings.' });

    expect(mockAppendMessage).toHaveBeenCalledWith('sess-1', 'assistant', 'Here are 3 matching listings.');
  });

  it('returns a graceful fallback message instead of an empty response when the underlying generation fails', async () => {
    mockGetOrCreateSession.mockResolvedValue({ id: 'sess-1', isNew: false });
    const rejection = Promise.reject(new Error('Failed to call a function. Please adjust your prompt.'));
    rejection.catch(() => {}); // avoid an unhandled-rejection warning before route.ts awaits it
    mockStream.mockReturnValue({ text: rejection });

    const res = await POST(makeRequest({ message: 'yes' }));
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text.length).toBeGreaterThan(0);
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

  it('strips raw function/tool tags leaked by the model from the output', async () => {
    mockGetOrCreateSession.mockResolvedValue({ id: 'sess-1', isNew: false });
    mockStream.mockReturnValue({
      text: Promise.resolve('Hello. (function=osmNearby>{"category": "transit"}</function> According to OSM, there is transit. <function=applyShortlistEdit>{"editIntent": {}}</function> Done.'),
    });

    const res = await POST(makeRequest({ message: 'how is transit' }));
    const text = await res.text();

    expect(text).toBe('Hello.  According to OSM, there is transit.  Done.');
  });
});
