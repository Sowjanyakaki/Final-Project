import { describe, it, expect } from 'vitest';
import { nearestLocality } from './nearestLocality';

describe('nearestLocality', () => {
  it('returns the matching locality name for coordinates right at its centroid', () => {
    expect(nearestLocality(12.9352, 77.6245)).toBe('Koramangala');
    expect(nearestLocality(12.9116, 77.6412)).toBe('HSR Layout');
  });

  it('returns the matching locality name for coordinates a short distance away', () => {
    expect(nearestLocality(12.94, 77.63)).toBe('Koramangala');
  });

  it('returns null for coordinates far from every default locality', () => {
    expect(nearestLocality(13.2, 77.9)).toBeNull();
  });

  it('returns null when lat or lng is missing', () => {
    expect(nearestLocality(null, 77.6245)).toBeNull();
    expect(nearestLocality(12.9352, null)).toBeNull();
    expect(nearestLocality(null, null)).toBeNull();
  });
});
