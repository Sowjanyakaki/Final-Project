import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { db } from '../lib/db/client';
import { sessions, shortlistItems as shortlistItemsTable, listings, toolCallLog } from '../lib/db/schema';
import type {
  Session,
  ShortlistItemWithListing,
  ToolCallLogRow,
  CommuteToolCallInput,
  FeasibilityFixture,
} from './types';

export async function runFeasibilityEval(
  session: Session,
  shortlistItems: ShortlistItemWithListing[],
  toolCallLogEntries: ToolCallLogRow[] = []
): Promise<{ pass: boolean; failures: string[] }> {
  const failures: string[] = [];
  const { budgetMax, bedrooms, mustHaves, commutePoint } = session.constraints;

  for (const item of shortlistItems) {
    if (item.status !== 'active') continue;
    const listing = item.listing;

    if ((listing.rent ?? Infinity) > budgetMax) {
      failures.push(
        `Listing ${item.listingId} (${listing.societyName}) rent ${listing.rent} exceeds budgetMax ${budgetMax}`
      );
    }

    if (listing.bedrooms !== bedrooms) {
      failures.push(
        `Listing ${item.listingId} (${listing.societyName}) has ${listing.bedrooms} bedrooms, expected ${bedrooms}`
      );
    }

    const amenities = Array.isArray(listing.amenities) ? (listing.amenities as string[]) : [];
    const missingMustHaves = mustHaves.filter((m) => !amenities.includes(m));
    if (missingMustHaves.length > 0) {
      failures.push(
        `Listing ${item.listingId} (${listing.societyName}) is missing must-have amenities: ${missingMustHaves.join(', ')}`
      );
    }
  }

  const commuteCalls = toolCallLogEntries.filter((entry) => {
    if (entry.toolName !== 'osmNearby') return false;
    const input = entry.input as Partial<CommuteToolCallInput> | null;
    return input?.category === 'commute';
  });

  for (const call of commuteCalls) {
    const input = call.input as CommuteToolCallInput;
    if (input.commutePoint !== commutePoint) {
      failures.push(
        `Commute analysis (tool_call_log id ${call.id}) was computed against "${input.commutePoint}" but the session's stated commute point is "${commutePoint}"`
      );
    }
  }

  return { pass: failures.length === 0, failures };
}

function parseArgs(argv: string[]): { fixture?: string; session?: string } {
  const args: { fixture?: string; session?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--fixture') args.fixture = argv[++i];
    if (argv[i] === '--session') args.session = argv[++i];
  }
  return args;
}

function loadFromFixture(path: string): FeasibilityFixture {
  return JSON.parse(readFileSync(path, 'utf-8')) as FeasibilityFixture;
}

async function loadFromDb(sessionId: string): Promise<FeasibilityFixture> {
  const [sessionRow] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!sessionRow) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const rows = await db
    .select({ item: shortlistItemsTable, listing: listings })
    .from(shortlistItemsTable)
    .innerJoin(listings, eq(shortlistItemsTable.listingId, listings.id))
    .where(eq(shortlistItemsTable.sessionId, sessionId));
  const joinedItems: ShortlistItemWithListing[] = rows.map((row) => ({ ...row.item, listing: row.listing }));

  const logs = await db.select().from(toolCallLog).where(eq(toolCallLog.sessionId, sessionId));

  return {
    session: sessionRow as unknown as Session,
    shortlistItems: joinedItems,
    toolCallLog: logs,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let data: FeasibilityFixture;

  if (args.fixture) {
    data = loadFromFixture(args.fixture);
  } else if (args.session) {
    data = await loadFromDb(args.session);
  } else {
    console.error('Usage: tsx evals/feasibility.ts --fixture <path> | --session <sessionId>');
    process.exit(1);
    return;
  }

  const result = await runFeasibilityEval(data.session, data.shortlistItems, data.toolCallLog);

  if (result.pass) {
    console.log('PASS: Feasibility eval passed.');
  } else {
    console.log('FAIL: Feasibility eval failed with the following issues:');
    for (const failure of result.failures) {
      console.log(`  - ${failure}`);
    }
  }

  process.exit(result.pass ? 0 : 1);
}

// tsx runs this file via esbuild, which shims `import.meta.url` even under CJS
// output, so this main-module check works regardless of package.json's "type".
const isMainModule = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
