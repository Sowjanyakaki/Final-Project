import { requireEnv } from './requireEnv';

type CancelBookingHoldInput = {
  code: string;
};

type CancelBookingHoldOutput = {
  status: string;
};

export async function cancelBookingHold(
  input: CancelBookingHoldInput
): Promise<CancelBookingHoldOutput> {
  const baseUrl = requireEnv('BOOKING_MCP_URL');
  const apiKey = requireEnv('BOOKING_MCP_API_KEY');

  const response = await fetch(`${baseUrl}/cancel_hold`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code: input.code }),
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new Error(
      `Booking MCP cancel_hold failed with status ${response.status}: ${bodyText || response.statusText}`
    );
  }

  const data = (await response.json()) as { status: string };
  return { status: data.status };
}
