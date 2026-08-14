import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import SearchBar from './SearchBar';

describe('SearchBar', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls onChange with the typed value after the debounce delay', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<SearchBar onChange={onChange} debounceMs={300} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Koramangala' } });
    expect(onChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith('Koramangala');
  });

  it('resets the debounce timer on each keystroke, calling onChange only once with the final value', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<SearchBar onChange={onChange} debounceMs={300} />);

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Kor' } });
    vi.advanceTimersByTime(200);
    fireEvent.change(input, { target: { value: 'Koramangala' } });
    vi.advanceTimersByTime(200);
    expect(onChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('Koramangala');
  });

  it('renders a defaultValue if provided', () => {
    render(<SearchBar onChange={vi.fn()} defaultValue="HSR Layout" />);

    expect(screen.getByRole('textbox')).toHaveValue('HSR Layout');
  });
});
