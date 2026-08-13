import { requireEnv } from './requireEnv';
import type { BookingSlot } from './types';

type ListBookingSlotsInput = {
  dayPreference: string;
  timePreference: string;
};

type ListBookingSlotsOutput = {
  slots: BookingSlot[];
};

export async function listBookingSlots(
  input: ListBookingSlotsInput
): Promise<ListBookingSlotsOutput> {
  const baseUrl = requireEnv('BOOKING_MCP_URL');
  const apiKey = requireEnv('BOOKING_MCP_API_KEY');

  const response = await fetch(`${baseUrl}/list_slots`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new Error(
      `Booking MCP list_slots failed with status ${response.status}: ${bodyText || response.statusText}`
    );
  }

  const data = (await response.json()) as { slots?: BookingSlot[] };
  return { slots: Array.isArray(data.slots) ? data.slots : [] };
}
