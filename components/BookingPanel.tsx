import { Booking } from '../lib/types';

interface BookingPanelProps {
  booking?: Booking;
}

const STATUS_MESSAGES: Record<Booking['status'], string> = {
  tentative: 'Your visit is tentatively booked. We will confirm shortly.',
  cancelled: 'This visit has been cancelled.',
  rescheduled: 'This visit has been rescheduled to a new slot.',
};

export default function BookingPanel({ booking }: BookingPanelProps) {
  if (!booking) {
    return (
      <section aria-label="Visit confirmation" data-testid="booking-panel">
        <p data-testid="booking-empty">No booking yet. Ask to schedule a visit to see it here.</p>
      </section>
    );
  }

  return (
    <section aria-label="Visit confirmation" data-testid="booking-panel">
      <p data-testid="booking-slot">{booking.slotLabel}</p>
      <p data-testid="booking-code">Confirmation code: {booking.confirmationCode}</p>
      <p data-testid="booking-status">{STATUS_MESSAGES[booking.status]}</p>
    </section>
  );
}
