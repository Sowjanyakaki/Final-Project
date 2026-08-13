import { requireEnv } from './requireEnv';
import type { BookingSlot } from './types';

type RescheduleBookingHoldInput = {
  code: string;
  newSlot: BookingSlot;
};

type RescheduleBookingHoldOutput = {
  holdId: string;
  status: string;
};

export async function rescheduleBookingHold(
  input: RescheduleBookingHoldInput
): Promise<RescheduleBookingHoldOutput> {
  const baseUrl = requireEnv('BOOKING_MCP_URL');
  const apiKey = requireEnv('BOOKING_MCP_API_KEY');

  const response = await fetch(`${baseUrl}/reschedule_hold`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code: input.code, newSlot: input.newSlot }),
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new Error(
      `Booking MCP reschedule_hold failed with status ${response.status}: ${bodyText || response.statusText}`
    );
  }

  const data = (await response.json()) as { holdId: string; status: string };
  return { holdId: data.holdId, status: data.status };
}
