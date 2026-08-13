import { randomBytes } from 'node:crypto';
import { requireEnv } from './requireEnv';
import type { BookingSlot } from './types';

type CreateBookingHoldInput = {
  sessionId: string;
  listingId: string;
  topic: string;
  slot: BookingSlot;
};

type CreateBookingHoldOutput = {
  confirmationCode: string;
  holdId: string;
  status: string;
};

export function generateConfirmationCode(): string {
  return `NL-${randomBytes(2).toString('hex').toUpperCase()}`;
}

export async function createBookingHold(
  input: CreateBookingHoldInput
): Promise<CreateBookingHoldOutput> {
  const baseUrl = requireEnv('BOOKING_MCP_URL');
  const apiKey = requireEnv('BOOKING_MCP_API_KEY');
  const code = generateConfirmationCode();

  const response = await fetch(`${baseUrl}/create_hold`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ topic: input.topic, code, slot: input.slot }),
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new Error(
      `Booking MCP create_hold failed with status ${response.status}: ${bodyText || response.statusText}`
    );
  }

  const data = (await response.json()) as { holdId: string; status: string };
  return { confirmationCode: code, holdId: data.holdId, status: data.status };
}
