import { describe, it, expect } from 'vitest';
import { runFeasibilityEval } from './feasibility';
import feasibilityPass from './fixtures/feasibility-pass.json';
import feasibilityBudgetViolation from './fixtures/feasibility-budget-violation.json';
import feasibilityCommuteMismatch from './fixtures/feasibility-commute-mismatch.json';
import type { FeasibilityFixture } from './types';

describe('runFeasibilityEval', () => {
  it('passes when the shortlist respects budget/bedrooms/mustHaves and commute matches', async () => {
    const fixture = feasibilityPass as unknown as FeasibilityFixture;
    const result = await runFeasibilityEval(fixture.session, fixture.shortlistItems, fixture.toolCallLog);
    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('fails and names the violating listings on budget/must-have violations', async () => {
    const fixture = feasibilityBudgetViolation as unknown as FeasibilityFixture;
    const result = await runFeasibilityEval(fixture.session, fixture.shortlistItems, fixture.toolCallLog);
    expect(result.pass).toBe(false);
    expect(result.failures.some((f) => f.includes('2'))).toBe(true);
    expect(result.failures.some((f) => f.includes('3'))).toBe(true);
  });

  it('fails when a commute claim was computed against a different commute point', async () => {
    const fixture = feasibilityCommuteMismatch as unknown as FeasibilityFixture;
    const result = await runFeasibilityEval(fixture.session, fixture.shortlistItems, fixture.toolCallLog);
    expect(result.pass).toBe(false);
    expect(result.failures.some((f) => f.includes('Indiranagar'))).toBe(true);
  });
});
