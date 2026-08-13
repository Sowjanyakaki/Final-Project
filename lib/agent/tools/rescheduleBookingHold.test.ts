import { describe, it, expect, beforeEach, vi } from 'vitest';
import { rescheduleBookingHold } from './rescheduleBookingHold';
import type { BookingSlot } from './types';

const newSlot: BookingSlot = { id: 'slot-9', startIso: '2026-08-13T10:00:00+05:30', label: 'Thu 10:00 AM' };

describe('rescheduleBookingHold', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    process.env.BOOKING_MCP_URL = 'https://booking-mcp.example.com';
    process.env.BOOKING_MCP_API_KEY = 'test-api-key';
  });

  it('reschedules a hold and returns its holdId and status', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ holdId: 'hold-123', status: 'tentative' }),
    } as Response);

    const result = await rescheduleBookingHold({ code: 'NL-A742', newSlot });

    expect(result).toEqual({ holdId: 'hold-123', status: 'tentative' });
    expect(fetch).toHaveBeenCalledWith(
      'https://booking-mcp.example.com/reschedule_hold',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-API-Key': 'test-api-key',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ code: 'NL-A742', newSlot }),
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

    await expect(rescheduleBookingHold({ code: 'NL-0000', newSlot })).rejects.toThrow(/404/);
  });

  it('throws on a 500 error from the Booking MCP', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'calendar backend unavailable',
    } as Response);

    await expect(rescheduleBookingHold({ code: 'NL-A742', newSlot })).rejects.toThrow(/500/);
  });
});
