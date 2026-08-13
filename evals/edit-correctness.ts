import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ShortlistItemWithListing, EditLogEntry, EditCorrectnessFixture } from './types';

function satisfiesComparator(actual: number, comparator: '<=' | '>=' | '<' | '>', value: number): boolean {
  switch (comparator) {
    case '<=':
      return actual <= value;
    case '>=':
      return actual >= value;
    case '<':
      return actual < value;
    case '>':
      return actual > value;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function runEditCorrectnessEval(
  beforeItems: ShortlistItemWithListing[],
  afterItems: ShortlistItemWithListing[],
  editLogEntry: EditLogEntry
): { pass: boolean; failures: string[] } {
  const failures: string[] = [];
  const beforeByListingId = new Map(beforeItems.map((item) => [item.listingId, item]));
  const afterByListingId = new Map(afterItems.map((item) => [item.listingId, item]));
  const changedSet = new Set(editLogEntry.output.changed);

  const allListingIds = new Set([...beforeByListingId.keys(), ...afterByListingId.keys()]);

  for (const listingId of allListingIds) {
    const before = beforeByListingId.get(listingId);
    const after = afterByListingId.get(listingId);

    if (!before || !after) {
      failures.push(
        `Listing ${listingId} is missing from ${!before ? 'beforeItems' : 'afterItems'}; edits must not add/remove shortlist rows`
      );
      continue;
    }

    const actuallyDiffers = before.status !== after.status || before.reason !== after.reason;
    const loggedAsChanged = changedSet.has(listingId);

    if (actuallyDiffers && !loggedAsChanged) {
      failures.push(
        `Listing ${listingId} (${after.listing.societyName}) changed status/reason but is not listed in editLogEntry.output.changed`
      );
    }

    if (!actuallyDiffers && loggedAsChanged) {
      failures.push(
        `Listing ${listingId} (${after.listing.societyName}) is listed in editLogEntry.output.changed but is byte-identical before/after`
      );
    }

    if (!loggedAsChanged && !deepEqual(before, after)) {
      failures.push(
        `Listing ${listingId} (${after.listing.societyName}) is not in editLogEntry.output.changed but differs between before and after (expected byte-identical)`
      );
    }
  }

  const { input: editIntent } = editLogEntry;
  if (editIntent.op === 'filter') {
    const { field, comparator, value } = editIntent;
    for (const listingId of changedSet) {
      const after = afterByListingId.get(listingId) ?? beforeByListingId.get(listingId);
      if (!after) continue;
      const fieldValue = after.listing[field];
      if (typeof fieldValue !== 'number') continue;
      if (satisfiesComparator(fieldValue, comparator, value)) {
        failures.push(
          `Listing ${listingId} (${after.listing.societyName}) was changed by a filter on ${field} ${comparator} ${value}, but its ${field} (${fieldValue}) actually satisfies that condition — it should not have been affected`
        );
      }
    }
  }
  // Semantic validation is implemented for `op: 'filter'` intents only — that is the
  // op kind ARCHITECTURE.md's example uses and the fixtures exercise. For `add`/
  // `remove` intents, only the before/after diff-consistency checks above run;
  // their exact semantics aren't pinned by the architecture doc, so this is a documented
  // scope limit, not a placeholder.

  return { pass: failures.length === 0, failures };
}

function parseArgs(argv: string[]): { fixture?: string } {
  const args: { fixture?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--fixture') args.fixture = argv[++i];
  }
  return args;
}

function loadFixture(path: string): EditCorrectnessFixture {
  return JSON.parse(readFileSync(path, 'utf-8')) as EditCorrectnessFixture;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.fixture) {
    console.error('Usage: tsx evals/edit-correctness.ts --fixture <path>');
    console.error(
      '(DB mode is not supported: lib/db/schema.ts does not persist a pre-edit shortlist snapshot, so "before" state can only come from a fixture file.)'
    );
    process.exit(1);
    return;
  }

  const fixture = loadFixture(args.fixture);
  const result = runEditCorrectnessEval(fixture.beforeItems, fixture.afterItems, fixture.editLogEntry);

  if (result.pass) {
    console.log('PASS: Edit correctness eval passed.');
  } else {
    console.log('FAIL: Edit correctness eval failed with the following issues:');
    for (const failure of result.failures) {
      console.log(`  - ${failure}`);
    }
  }

  process.exit(result.pass ? 0 : 1);
}

const isMainModule = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main();
}
