// components/FilterPills.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import FilterPills from './FilterPills';

describe('FilterPills', () => {
  it('renders a static, non-interactive "For Rent" pill', () => {
    render(<FilterPills bedrooms={undefined} onBedroomsChange={vi.fn()} />);

    const forRent = screen.getByTestId('pill-for-rent');
    expect(forRent).toHaveTextContent('For Rent');
    expect(forRent.tagName).not.toBe('BUTTON');
  });

  it('calls onBedroomsChange(2) when the 2 BHK pill is clicked', () => {
    const onBedroomsChange = vi.fn();
    render(<FilterPills bedrooms={undefined} onBedroomsChange={onBedroomsChange} />);

    fireEvent.click(screen.getByTestId('pill-2bhk'));

    expect(onBedroomsChange).toHaveBeenCalledWith(2);
  });

  it('calls onBedroomsChange(undefined) when the already-active pill is clicked again', () => {
    const onBedroomsChange = vi.fn();
    render(<FilterPills bedrooms={2} onBedroomsChange={onBedroomsChange} />);

    const pill = screen.getByTestId('pill-2bhk');
    expect(pill).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(pill);

    expect(onBedroomsChange).toHaveBeenCalledWith(undefined);
  });

  it('marks only the matching pill as pressed', () => {
    render(<FilterPills bedrooms={3} onBedroomsChange={vi.fn()} />);

    expect(screen.getByTestId('pill-2bhk')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('pill-3bhk')).toHaveAttribute('aria-pressed', 'true');
  });
});
