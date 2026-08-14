import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockApplyShortlistEdit } = vi.hoisted(() => ({ mockApplyShortlistEdit: vi.fn() }));
const { mockCookieGet, mockCookies } = vi.hoisted(() => {
  const mockCookieGet = vi.fn();
  const mockCookies = vi.fn(() => Promise.resolve({ get: mockCookieGet }));
  return { mockCookieGet, mockCookies };
});

vi.mock('../../../../lib/agent/tools/applyShortlistEdit', () => ({ applyShortlistEdit: mockApplyShortlistEdit }));
vi.mock('next/headers', () => ({ cookies: mockCookies }));

import { POST } from './route';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/shortlist/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/shortlist/remove', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCookies.mockReturnValue(Promise.resolve({ get: mockCookieGet }));
    mockCookieGet.mockReturnValue({ value: 'sess-1' });
  });

  it('removes the listing from the session shortlist', async () => {
    mockApplyShortlistEdit.mockResolvedValue({ changed: [42], unchanged: [7] });

    const res = await POST(makeRequest({ listingId: 42 }));
    const json = await res.json();

    expect(mockApplyShortlistEdit).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      editIntent: { op: 'remove', listingId: 42 },
    });
    expect(json).toEqual({ changed: [42], unchanged: [7] });
  });

  it('returns 400 when listingId is missing', async () => {
    const res = await POST(makeRequest({}));

    expect(res.status).toBe(400);
    expect(mockApplyShortlistEdit).not.toHaveBeenCalled();
  });

  it('returns 400 when there is no session cookie', async () => {
    mockCookieGet.mockReturnValue(undefined);

    const res = await POST(makeRequest({ listingId: 42 }));

    expect(res.status).toBe(400);
    expect(mockApplyShortlistEdit).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid JSON', async () => {
    const res = await POST(
      new Request('http://localhost/api/shortlist/remove', { method: 'POST', body: 'not json' })
    );

    expect(res.status).toBe(400);
  });
});
