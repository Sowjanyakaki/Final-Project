import { eq } from 'drizzle-orm';
import { db } from '../lib/db/client';
import { neighborhoodDocs } from '../lib/db/schema';
import { embedText } from '../lib/rag/embed';

/**
 * Initial fixed locality list for the neighborhood RAG corpus. This is a
 * documented default, not a placeholder — edit this array to add/remove
 * localities as the scraped listings' locality coverage grows. Matches
 * lib/geo/nearestLocality.ts's DEFAULT_LOCALITIES so every locality a
 * listing can be tagged with also has RAG coverage.
 */
export const DEFAULT_LOCALITIES = [
  'Koramangala',
  'HSR Layout',
  'Indiranagar',
  'Whitefield',
  'Jayanagar',
] as const;

const WIKIPEDIA_API_BASE = 'https://en.wikipedia.org/w/api.php';

/** Builds the Wikipedia "plain text extract" API URL for a locality title. */
export function wikipediaApiUrl(locality: string): string {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'extracts',
    explaintext: '1',
    format: 'json',
    redirects: '1',
    titles: locality,
  });
  return `${WIKIPEDIA_API_BASE}?${params.toString()}`;
}

/**
 * Splits text into ~targetTokens-word windows. "Tokens" here is approximated
 * as whitespace-delimited words (no real tokenizer dependency) — good enough
 * for chunk-sizing a RAG corpus at prototype scale.
 */
export function chunkText(text: string, targetTokens: number = 500): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }

  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += targetTokens) {
    chunks.push(words.slice(i, i + targetTokens).join(' '));
  }
  return chunks;
}

interface WikipediaExtractPage {
  title?: string;
  extract?: string;
}

interface WikipediaExtractResponse {
  query?: {
    pages?: Record<string, WikipediaExtractPage>;
  };
}

/**
 * Fetches a locality's Wikipedia plain-text extract via the Wikipedia Action
 * API (no HTML parsing needed — `explaintext=1` returns plain text directly).
 * Accepts an injectable fetchFn so tests never hit the real network.
 */
export async function fetchLocalityPage(
  locality: string,
  fetchFn: typeof fetch = fetch
): Promise<{ title: string; url: string; text: string }> {
  const apiUrl = wikipediaApiUrl(locality);
  const res = await fetchFn(apiUrl);
  if (!res.ok) {
    throw new Error(`Wikipedia fetch failed for "${locality}": HTTP ${res.status}`);
  }

  const json = (await res.json()) as WikipediaExtractResponse;
  const pages = json.query?.pages ?? {};
  const page = Object.values(pages)[0];

  const title = page?.title ?? locality;
  const text = page?.extract?.trim() ?? '';
  const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

  return { title, url, text };
}

export interface IngestLocalityDeps {
  fetchFn?: typeof fetch;
  embed?: (text: string) => Promise<number[]>;
  dbClient?: Pick<typeof db, 'insert' | 'delete'>;
  targetTokens?: number;
}

/**
 * Ingests one locality's Wikipedia text into `neighborhood_docs`: fetch ->
 * chunk -> embed each chunk -> replace that locality's existing rows with
 * the freshly chunked/embedded set (delete-then-insert makes re-running this
 * per locality idempotent instead of accumulating duplicate chunks).
 * Returns the number of chunks inserted (0 if the source page had no text).
 */
export async function ingestLocality(
  locality: string,
  deps: IngestLocalityDeps = {}
): Promise<number> {
  const { fetchFn = fetch, embed = embedText, dbClient = db, targetTokens = 500 } = deps;

  const { title, url, text } = await fetchLocalityPage(locality, fetchFn);
  const chunks = chunkText(text, targetTokens);

  await dbClient.delete(neighborhoodDocs).where(eq(neighborhoodDocs.locality, locality));

  if (chunks.length === 0) {
    return 0;
  }

  const rows = [];
  for (const chunk of chunks) {
    const embedding = await embed(chunk);
    rows.push({
      locality,
      sourceTitle: title,
      sourceUrl: url,
      chunkText: chunk,
      embedding,
      fetchedAt: new Date(),
    });
  }

  await dbClient.insert(neighborhoodDocs).values(rows);
  return rows.length;
}

/**
 * Live ingestion entry point: run over DEFAULT_LOCALITIES (or CLI args, if
 * given) against the real DB, fetch, and embedding pipeline.
 */
async function main(): Promise<void> {
  const localities = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_LOCALITIES;
  for (const locality of localities) {
    const count = await ingestLocality(locality);
    console.log(`[ingest-neighborhood-docs] ${locality}: inserted ${count} chunk(s)`);
  }
}

// Vitest sets process.env.VITEST during test runs — this keeps `import`ing
// this module for its pure functions from ever hitting the network or DB.
if (!process.env.VITEST) {
  main().catch((err) => {
    console.error('[ingest-neighborhood-docs] failed:', err);
    process.exit(1);
  });
}
