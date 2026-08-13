import { describe, it, expect, afterEach } from 'vitest';
import { requireEnv } from './requireEnv';

describe('requireEnv', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns the value when the env var is set', () => {
    process.env.SOME_TEST_VAR = 'hello';
    expect(requireEnv('SOME_TEST_VAR')).toBe('hello');
  });

  it('throws a clear error when the env var is missing', () => {
    delete process.env.SOME_TEST_VAR;
    expect(() => requireEnv('SOME_TEST_VAR')).toThrow('SOME_TEST_VAR is not configured');
  });

  it('throws when the env var is set but empty', () => {
    process.env.SOME_TEST_VAR = '';
    expect(() => requireEnv('SOME_TEST_VAR')).toThrow('SOME_TEST_VAR is not configured');
  });
});
