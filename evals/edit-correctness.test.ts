import { describe, it, expect } from 'vitest';
import { runEditCorrectnessEval } from './edit-correctness';
import editCorrect from './fixtures/edit-correct.json';
import editBuggy from './fixtures/edit-buggy.json';
import type { EditCorrectnessFixture } from './types';

describe('runEditCorrectnessEval', () => {
  it('passes when only listings matching the edit intent changed', () => {
    const fixture = editCorrect as unknown as EditCorrectnessFixture;
    const result = runEditCorrectnessEval(fixture.beforeItems, fixture.afterItems, fixture.editLogEntry);
    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('fails and names the wrongly-changed listing when an unrelated row changed', () => {
    const fixture = editBuggy as unknown as EditCorrectnessFixture;
    const result = runEditCorrectnessEval(fixture.beforeItems, fixture.afterItems, fixture.editLogEntry);
    expect(result.pass).toBe(false);
    expect(result.failures.some((f) => f.includes('4'))).toBe(true);
  });
});
