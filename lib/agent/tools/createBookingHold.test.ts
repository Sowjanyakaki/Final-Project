import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createBookingHold } from './createBookingHold';
import type { BookingSlot } from './types';

const slot: BookingSlot = { id: 'slot-1', startIso: '2026-08-12T10:00:00+05:30', label: 'Wed 10:00 AM' };

describe('createBookingHold', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    process.env.BOOKING_MCP_URL = 'https://booking-mcp.example.com';
    process.env.BOOKING_MCP_API_KEY = 'test-api-key';
  });

  it('generates an NL-XXXX confirmation code and returns the hold details', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ holdId: 'hold-123', status: 'tentative' }),
    } as Response);

    const result = await createBookingHold({
      sessionId: 'session-1',
      listingId: 'listing-1',
      topic: 'Green Meadows, Koramangala',
      slot,
    });

    expect(result.confirmationCode).toMatch(/^NL-[0-9A-F]{4}$/);
    expect(result.holdId).toBe('hold-123');
    expect(result.status).toBe('tentative');

    const [url, options] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://booking-mcp.example.com/create_hold');
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual(
      expect.objectContaining({ 'X-API-Key': 'test-api-key', 'Content-Type': 'application/json' })
    );
    expect(JSON.parse(options.body as string)).toEqual({
      topic: 'Green Meadows, Koramangala',
      code: result.confirmationCode,
      slot,
    });
  });

  it('throws when the Booking MCP rejects the hold as not approved (403)', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: async () => 'hold not approved',
    } as Response);

    await expect(
      createBookingHold({ sessionId: 's1', listingId: 'l1', topic: 'Test Society, Test Area', slot })
    ).rejects.toThrow(/403/);
  });

  it('throws on a 500 error from the Booking MCP', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'calendar backend unavailable',
    } as Response);

    await expect(
      createBookingHold({ sessionId: 's1', listingId: 'l1', topic: 'Test Society, Test Area', slot })
    ).rejects.toThrow(/500/);
  });
});
