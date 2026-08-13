import { describe, it, expect, vi, beforeEach } from 'vitest';

const generateObjectMock = vi.fn();
vi.mock('ai', () => ({
  generateObject: (...args: unknown[]) => generateObjectMock(...args),
}));
vi.mock('@ai-sdk/groq', () => ({
  groq: (modelId: string) => ({ modelId }),
}));

import { runGroundingEval } from './grounding';
import groundedFixture from './fixtures/grounding-fully-grounded.json';
import noCitationFixture from './fixtures/grounding-no-citation.json';
import mismatchFixture from './fixtures/grounding-citation-mismatch.json';
import uncertaintyFixture from './fixtures/grounding-uncertainty-stated.json';
import type { GroundingFixture } from './types';

describe('runGroundingEval', () => {
  beforeEach(() => {
    generateObjectMock.mockReset();
  });

  it('passes for a fully-grounded, correctly cited claim', async () => {
    generateObjectMock.mockResolvedValue({
      object: { supported: true, reasoning: 'The chunk text confirms the claim.' },
    });
    const fixture = groundedFixture as unknown as GroundingFixture;
    const result = await runGroundingEval(fixture.transcript, fixture.shortlistItems);
    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('fails when a neighborhood claim has no citation and no stated uncertainty', async () => {
    const fixture = noCitationFixture as unknown as GroundingFixture;
    const result = await runGroundingEval(fixture.transcript, fixture.shortlistItems);
    expect(result.pass).toBe(false);
    expect(generateObjectMock).not.toHaveBeenCalled();
  });

  it('fails when the cited source does not actually support the claim', async () => {
    generateObjectMock.mockResolvedValue({
      object: { supported: false, reasoning: 'The source says the nearest metro is kilometers away.' },
    });
    const fixture = mismatchFixture as unknown as GroundingFixture;
    const result = await runGroundingEval(fixture.transcript, fixture.shortlistItems);
    expect(result.pass).toBe(false);
    expect(result.failures.some((f) => f.includes('does not support the claim'))).toBe(true);
  });

  it('passes when uncertainty is explicitly stated instead of guessing', async () => {
    const fixture = uncertaintyFixture as unknown as GroundingFixture;
    const result = await runGroundingEval(fixture.transcript, fixture.shortlistItems);
    expect(result.pass).toBe(true);
    expect(generateObjectMock).not.toHaveBeenCalled();
  });
});
