import type { InferSelectModel } from 'drizzle-orm';
import type { listings, sessions, shortlistItems, toolCallLog } from '../lib/db/schema';
import type { EditIntent, ShortlistDiff } from '../lib/agent/tools/applyShortlistEdit';

export type Listing = InferSelectModel<typeof listings>;
export type SessionRow = InferSelectModel<typeof sessions>;
export type ShortlistItem = InferSelectModel<typeof shortlistItems>;
export type ToolCallLogRow = InferSelectModel<typeof toolCallLog>;

/** Shape of `sessions.constraints` (untyped JSON at the DB layer). */
export type Constraints = {
  budgetMax: number;
  bedrooms: number;
  mustHaves: string[];
  commutePoint: string;
};

export type Session = Omit<SessionRow, 'constraints'> & { constraints: Constraints };

/**
 * Reused verbatim from the orchestration-agent subsystem (lib/agent/tools/applyShortlistEdit.ts)
 * rather than redeclared here, so this eval can never drift from the real shape.
 */
export type { EditIntent };

export type EditLogEntry = {
  input: EditIntent;
  output: ShortlistDiff;
};

export type ShortlistItemWithListing = ShortlistItem & { listing: Listing };

/**
 * `toolCallLog.input`/`output` for an `osmNearby` call with category 'commute'.
 *
 * Known gap (flagged, not silently papered over): the real osmNearby tool
 * (lib/agent/tools/osmNearby.ts) only takes `{ lat, lng, category }` — it has
 * no `commutePoint` field. This eval's commute-consistency check therefore
 * only works against fixtures (or a future orchestrator revision that echoes
 * the commute point into the tool call input); it will not usefully validate
 * real `toolCallLog` rows produced by the current orchestrator until that's
 * added upstream.
 */
export type CommuteToolCallInput = {
  lat: number;
  lng: number;
  category: 'commute';
  commutePoint: string;
};
export type CommuteToolCallOutput = {
  items: unknown[];
  uncertain: boolean;
  note?: string;
};

/** A citation attached to a transcript entry — a subset of a retrieveNeighborhoodDocs chunk. */
export type TranscriptCitation = {
  sourceTitle: string;
  sourceUrl: string;
  chunkText: string;
};

export type TranscriptEntry = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  citations?: TranscriptCitation[];
};

export type FeasibilityFixture = {
  session: Session;
  shortlistItems: ShortlistItemWithListing[];
  toolCallLog: ToolCallLogRow[];
};

export type EditCorrectnessFixture = {
  beforeItems: ShortlistItemWithListing[];
  afterItems: ShortlistItemWithListing[];
  editLogEntry: EditLogEntry;
};

export type GroundingFixture = {
  transcript: TranscriptEntry[];
  shortlistItems: ShortlistItemWithListing[];
};
