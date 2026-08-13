import { describe, it, expect } from 'vitest';
import type { FeasibilityFixture, EditCorrectnessFixture, GroundingFixture } from '../types';
import feasibilityPass from './feasibility-pass.json';
import feasibilityBudgetViolation from './feasibility-budget-violation.json';
import feasibilityCommuteMismatch from './feasibility-commute-mismatch.json';
import editCorrect from './edit-correct.json';
import editBuggy from './edit-buggy.json';
import groundingFullyGrounded from './grounding-fully-grounded.json';
import groundingNoCitation from './grounding-no-citation.json';
import groundingCitationMismatch from './grounding-citation-mismatch.json';
import groundingUncertaintyStated from './grounding-uncertainty-stated.json';

describe('eval fixtures', () => {
  it('feasibility fixtures have a session with numeric budgetMax and array fields', () => {
    for (const fixture of [
      feasibilityPass,
      feasibilityBudgetViolation,
      feasibilityCommuteMismatch,
    ] as unknown as FeasibilityFixture[]) {
      expect(typeof fixture.session.constraints.budgetMax).toBe('number');
      expect(Array.isArray(fixture.session.constraints.mustHaves)).toBe(true);
      expect(Array.isArray(fixture.shortlistItems)).toBe(true);
      expect(Array.isArray(fixture.toolCallLog)).toBe(true);
    }
  });

  it('edit-correctness fixtures have before/after arrays and a filter editLogEntry', () => {
    for (const fixture of [editCorrect, editBuggy] as unknown as EditCorrectnessFixture[]) {
      expect(Array.isArray(fixture.beforeItems)).toBe(true);
      expect(Array.isArray(fixture.afterItems)).toBe(true);
      expect(Array.isArray(fixture.editLogEntry.output.changed)).toBe(true);
      expect(fixture.editLogEntry.input.op).toBe('filter');
    }
  });

  it('grounding fixtures have a transcript array and joined shortlistItems', () => {
    for (const fixture of [
      groundingFullyGrounded,
      groundingNoCitation,
      groundingCitationMismatch,
      groundingUncertaintyStated,
    ] as unknown as GroundingFixture[]) {
      expect(Array.isArray(fixture.transcript)).toBe(true);
      expect(Array.isArray(fixture.shortlistItems)).toBe(true);
      expect(fixture.shortlistItems[0].listing.id).toBe(1);
    }
  });
});
