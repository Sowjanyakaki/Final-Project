import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import VoiceSheet from './VoiceSheet';

vi.mock('./VoiceBar', () => ({
  default: () => <div data-testid="voice-bar-stub" />,
}));

describe('VoiceSheet', () => {
  it('renders nothing when closed', () => {
    render(<VoiceSheet open={false} onClose={vi.fn()} />);

    expect(screen.queryByTestId('voice-sheet')).not.toBeInTheDocument();
  });

  it('renders VoiceBar inside the sheet when open', () => {
    render(<VoiceSheet open onClose={vi.fn()} />);

    expect(screen.getByTestId('voice-sheet')).toBeInTheDocument();
    expect(screen.getByTestId('voice-bar-stub')).toBeInTheDocument();
  });

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<VoiceSheet open onClose={onClose} />);

    fireEvent.click(screen.getByTestId('voice-sheet-backdrop'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when the sheet content itself is clicked', () => {
    const onClose = vi.fn();
    render(<VoiceSheet open onClose={onClose} />);

    fireEvent.click(screen.getByTestId('voice-sheet'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<VoiceSheet open onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close voice assistant' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
