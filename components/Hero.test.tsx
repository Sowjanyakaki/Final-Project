// components/Hero.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import Hero from './Hero';

describe('Hero', () => {
  it('renders the headline and subtitle', () => {
    render(<Hero />);

    expect(screen.getByRole('heading', { name: 'Find your perfect home' })).toBeInTheDocument();
    expect(screen.getByText('Discover available rentals curated for you.')).toBeInTheDocument();
  });
});
