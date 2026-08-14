import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import FloatingMicButton from './FloatingMicButton';

describe('FloatingMicButton', () => {
  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<FloatingMicButton onClick={onClick} />);

    screen.getByRole('button', { name: 'Open voice assistant' }).click();

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
