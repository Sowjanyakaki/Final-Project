import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import BottomNav from './BottomNav';

describe('BottomNav', () => {
  it('marks Explore as the active tab', () => {
    render(<BottomNav onOpenVoice={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Explore' })).toHaveAttribute('aria-current', 'page');
  });

  it('calls onOpenVoice when the AI Scout tab is clicked', () => {
    const onOpenVoice = vi.fn();
    render(<BottomNav onOpenVoice={onOpenVoice} />);

    screen.getByRole('button', { name: 'AI Scout' }).click();

    expect(onOpenVoice).toHaveBeenCalledTimes(1);
  });

  it('disables the Saved and Profile placeholder tabs', () => {
    render(<BottomNav onOpenVoice={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Profile' })).toBeDisabled();
  });
});
