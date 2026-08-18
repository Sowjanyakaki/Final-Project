import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateObject } from 'ai';
import { groq } from '@ai-sdk/groq';
import { z } from 'zod';
import type { TranscriptEntry, ShortlistItemWithListing, GroundingFixture } from './types';

const groundingJudgeSchema = z.object({
  supported: z.boolean(),
  reasoning: z.string(),
});

// Case-insensitive substring check against a fixed list of uncertainty phrases.
// This is the exact, documented rule for "uncertainty was explicitly stated":
// if the transcript entry's content contains any of these phrases, missing
// citations on that entry are not treated as a hallucination-risk failure.
const UNCERTAINTY_PHRASES = [
  "don't have reliable data",
  'do not have reliable data',
  'no reliable data',
  "don't have enough information",
  'do not have enough information',
  'unavailable',
  'uncertain',
  "can't confirm",
  'cannot confirm',
];

function statesUncertainty(content: string): boolean {
  const lower = content.toLowerCase();
  return UNCERTAINTY_PHRASES.some((phrase) => lower.includes(phrase));
}

const NEIGHBORHOOD_CLAIM_PATTERN = /neighbo(u)?rhood|safe|safety|transit|metro|commute|amenit|area|locality/i;

async function judgeClaimSupport(claim: string, chunkText: string): Promise<{ supported: boolean; reasoning: string }> {
  const { object } = await generateObject({
    model: groq('openai/gpt-oss-120b'),
    schema: groundingJudgeSchema,
    prompt: `You are fact-checking a neighborhood claim made by a real-estate assistant against its cited source text. Respond with a JSON object matching the required schema.

Claim: "${claim}"

Cited source text: "${chunkText}"

Does the cited source text actually support the claim? Respond with supported=true if the source text backs up what the claim states, including when the claim is about a specific property or street and the source describes the general character (safety, amenities, transit, etc.) of the broader locality that property is in — a locality-level description supports a property-level claim about that same locality unless the source specifically contradicts it. Respond with supported=false only if the source contradicts the claim or is silent/unrelated to the topic of the claim, and explain why in reasoning.`,
  });
  return object;
}

function extractListingMentions(
  content: string,
  shortlistItems: ShortlistItemWithListing[]
): ShortlistItemWithListing[] {
  return shortlistItems.filter(
    (item) => content.includes(String(item.listingId)) || content.includes(item.listing.societyName ?? '')
  );
}

export async function runGroundingEval(
  transcript: TranscriptEntry[],
  shortlistItems: ShortlistItemWithListing[]
): Promise<{ pass: boolean; failures: string[] }> {
  const failures: string[] = [];

  for (const [index, entry] of transcript.entries()) {
    if (entry.role !== 'assistant') continue;

    const mentionedListings = extractListingMentions(entry.content, shortlistItems);
    for (const item of mentionedListings) {
      if (item.listing.availabilityStatus !== 'available') {
        failures.push(
          `Transcript entry ${index}: references listing ${item.listingId} (${item.listing.societyName}), which is not marked "available"`
        );
      }
    }

    const looksLikeNeighborhoodClaim = NEIGHBORHOOD_CLAIM_PATTERN.test(entry.content);
    const hasCitations = Boolean(entry.citations && entry.citations.length > 0);

    if (looksLikeNeighborhoodClaim && !hasCitations) {
      if (!statesUncertainty(entry.content)) {
        failures.push(
          `Transcript entry ${index}: makes a neighborhood claim with no citation and no stated uncertainty ("${entry.content.slice(0, 80)}...")`
        );
      }
      continue;
    }

    if (hasCitations) {
      for (const citation of entry.citations!) {
        const judgment = await judgeClaimSupport(entry.content, citation.chunkText);
        if (!judgment.supported) {
          failures.push(
            `Transcript entry ${index}: citation "${citation.sourceTitle}" (${citation.sourceUrl}) does not support the claim — judge reasoning: ${judgment.reasoning}`
          );
        }
      }
    }
  }

  return { pass: failures.length === 0, failures };
}

function parseArgs(argv: string[]): { fixture?: string } {
  const args: { fixture?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--fixture') args.fixture = argv[++i];
  }
  return args;
}

function loadFixture(path: string): GroundingFixture {
  return JSON.parse(readFileSync(path, 'utf-8')) as GroundingFixture;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.fixture) {
    console.error('Usage: tsx evals/grounding.ts --fixture <path>');
    console.error(
      '(DB mode is not supported: lib/db/schema.ts has no transcript table/column, so transcripts can only be supplied via a fixture file for now.)'
    );
    process.exit(1);
    return;
  }
  if (!process.env.GROQ_API_KEY) {
    console.error(
      'GROQ_API_KEY is not set. The grounding eval calls Groq via generateObject to judge citation support; set GROQ_API_KEY for a live run (Vitest tests mock this call instead).'
    );
    process.exit(1);
    return;
  }

  const fixture = loadFixture(args.fixture);
  const result = await runGroundingEval(fixture.transcript, fixture.shortlistItems);

  if (result.pass) {
    console.log('PASS: Grounding eval passed.');
  } else {
    console.log('FAIL: Grounding eval failed with the following issues:');
    for (const failure of result.failures) {
      console.log(`  - ${failure}`);
    }
  }

  process.exit(result.pass ? 0 : 1);
}

const isMainModule = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
