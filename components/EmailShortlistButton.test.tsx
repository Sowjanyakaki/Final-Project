import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmailShortlistButton } from './EmailShortlistButton';

describe('EmailShortlistButton', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('disables the button when the email is empty', () => {
    render(<EmailShortlistButton sessionId="sess-1" />);
    expect(screen.getByRole('button', { name: /email me this shortlist/i })).toBeDisabled();
  });

  it('shows a validation message and keeps the button disabled for an invalid email', async () => {
    const user = userEvent.setup();
    render(<EmailShortlistButton sessionId="sess-1" />);

    await user.type(screen.getByLabelText(/email address/i), 'not-an-email');

    expect(screen.getByRole('button', { name: /email me this shortlist/i })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/valid email/i);
  });

  it('shows loading then success for a valid email on a successful call', async () => {
    // A deferred (not immediately-resolved) fetch mock, so the 'loading' state
    // is actually observable before the call settles — an immediately-resolved
    // mock races past 'loading' before userEvent.click's internal act()
    // flushing returns, making the loading assertion flaky/false.
    let resolveFetch!: (value: Response) => void;
    global.fetch = vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    const user = userEvent.setup();
    render(<EmailShortlistButton sessionId="sess-1" />);

    await user.type(screen.getByLabelText(/email address/i), 'user@example.com');
    const button = screen.getByRole('button', { name: /email me this shortlist/i });
    expect(button).toBeEnabled();

    void user.click(button);
    await waitFor(() => expect(screen.getByRole('button', { name: /sending/i })).toBeDisabled());

    resolveFetch(new Response(JSON.stringify({ status: 'sent' }), { status: 200 }));
    await waitFor(() => expect(screen.getByText(/shortlist sent/i)).toBeInTheDocument());

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/notify',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ sessionId: 'sess-1', email: 'user@example.com' }),
      })
    );
  });

  it('shows an error message when the call fails', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'No active shortlist items to send for this session' }), { status: 400 })
    );
    const user = userEvent.setup();
    render(<EmailShortlistButton sessionId="sess-1" />);

    await user.type(screen.getByLabelText(/email address/i), 'user@example.com');
    await user.click(screen.getByRole('button', { name: /email me this shortlist/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/no active shortlist items/i));
  });

  it('shows a generic error message when fetch throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    const user = userEvent.setup();
    render(<EmailShortlistButton sessionId="sess-1" />);

    await user.type(screen.getByLabelText(/email address/i), 'user@example.com');
    await user.click(screen.getByRole('button', { name: /email me this shortlist/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not reach the server/i));
  });
});
