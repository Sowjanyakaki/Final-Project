import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import BookingPanel from './BookingPanel';

describe('BookingPanel', () => {
  it('renders an empty state when there is no booking', () => {
    render(<BookingPanel />);
    expect(screen.getByTestId('booking-empty')).toHaveTextContent('No booking yet');
  });

  it('renders slot, confirmation code, and message for a tentative booking', () => {
    render(
      <BookingPanel
        booking={{ slotLabel: 'Sat, 10 Aug, 10:00 AM', confirmationCode: 'NL-A742', status: 'tentative' }}
      />
    );
    expect(screen.getByTestId('booking-slot')).toHaveTextContent('Sat, 10 Aug, 10:00 AM');
    expect(screen.getByTestId('booking-code')).toHaveTextContent('NL-A742');
    expect(screen.getByTestId('booking-status')).toHaveTextContent('tentatively booked');
  });

  it('renders a cancelled-specific message', () => {
    render(
      <BookingPanel
        booking={{ slotLabel: 'Sat, 10 Aug, 10:00 AM', confirmationCode: 'NL-A742', status: 'cancelled' }}
      />
    );
    expect(screen.getByTestId('booking-status')).toHaveTextContent('cancelled');
  });

  it('renders a rescheduled-specific message', () => {
    render(
      <BookingPanel
        booking={{ slotLabel: 'Sun, 11 Aug, 3:00 PM', confirmationCode: 'NL-B913', status: 'rescheduled' }}
      />
    );
    expect(screen.getByTestId('booking-slot')).toHaveTextContent('Sun, 11 Aug, 3:00 PM');
    expect(screen.getByTestId('booking-status')).toHaveTextContent('rescheduled');
  });
});
