import { describe, it, expect, beforeEach, vi } from 'vitest';
import { listBookingSlots } from './listBookingSlots';

describe('listBookingSlots', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    process.env.BOOKING_MCP_URL = 'https://booking-mcp.example.com';
    process.env.BOOKING_MCP_API_KEY = 'test-api-key';
  });

  it('returns slots on a successful 2-slot response', async () => {
    const slots = [
      { id: 'slot-1', startIso: '2026-08-12T10:00:00+05:30', label: 'Wed 10:00 AM' },
      { id: 'slot-2', startIso: '2026-08-12T15:00:00+05:30', label: 'Wed 3:00 PM' },
    ];
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ slots }),
    } as Response);

    const result = await listBookingSlots({ dayPreference: 'wednesday', timePreference: 'morning' });

    expect(result).toEqual({ slots });
    expect(fetch).toHaveBeenCalledWith(
      'https://booking-mcp.example.com/list_slots',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-API-Key': 'test-api-key',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ dayPreference: 'wednesday', timePreference: 'morning' }),
      })
    );
  });

  it('returns an empty slots array when there is no availability', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ slots: [] }),
    } as Response);

    const result = await listBookingSlots({ dayPreference: 'sunday', timePreference: 'evening' });

    expect(result).toEqual({ slots: [] });
  });

  it('throws a clear error on a non-2xx response', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'calendar backend unavailable',
    } as Response);

    await expect(
      listBookingSlots({ dayPreference: 'wednesday', timePreference: 'morning' })
    ).rejects.toThrow(/500/);
  });
});
