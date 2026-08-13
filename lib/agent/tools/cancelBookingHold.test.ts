import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cancelBookingHold } from './cancelBookingHold';

describe('cancelBookingHold', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    process.env.BOOKING_MCP_URL = 'https://booking-mcp.example.com';
    process.env.BOOKING_MCP_API_KEY = 'test-api-key';
  });

  it('cancels a hold and returns its status', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'cancelled' }),
    } as Response);

    const result = await cancelBookingHold({ code: 'NL-A742' });

    expect(result).toEqual({ status: 'cancelled' });
    expect(fetch).toHaveBeenCalledWith(
      'https://booking-mcp.example.com/cancel_hold',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-API-Key': 'test-api-key',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ code: 'NL-A742' }),
      })
    );
  });

  it('throws a clear error when the hold code is not found (404)', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => 'hold not found',
    } as Response);

    await expect(cancelBookingHold({ code: 'NL-0000' })).rejects.toThrow(/404/);
  });

  it('throws on a 500 error from the Booking MCP', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'calendar backend unavailable',
    } as Response);

    await expect(cancelBookingHold({ code: 'NL-A742' })).rejects.toThrow(/500/);
  });
});
