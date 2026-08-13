import { eq } from 'drizzle-orm';
import { cosineSimilarity } from 'ai';
import { db } from '../../db/client';
import { neighborhoodDocs } from '../../db/schema';
import { embedText } from '../../rag/embed';

const TOP_K = 3;

export interface RetrieveNeighborhoodDocsInput {
  locality: string;
  topic: string;
}

export interface NeighborhoodChunk {
  chunkText: string;
  sourceTitle: string;
  sourceUrl: string;
}

export interface RetrieveNeighborhoodDocsResult {
  chunks: NeighborhoodChunk[];
  uncertain: boolean;
}

type Row = NeighborhoodChunk & { embedding: number[] | null };

/**
 * Similarity search over neighborhoodDocs, scoped to a locality. The real
 * Postgres+pgvector schema (docs/ARCHITECTURE.md §4) would push this ranking
 * into SQL via the `<=>` cosine-distance operator; SQLite has no vector
 * index, so this fetches the locality's rows and ranks them by cosine
 * similarity in application code instead — same result, just computed here.
 * Returns uncertain:true (and no chunks) whenever there is nothing to ground
 * a claim in — callers (the orchestrator's system prompt) must never
 * fabricate a neighborhood fact in that case.
 */
export async function retrieveNeighborhoodDocs(
  input: RetrieveNeighborhoodDocsInput
): Promise<RetrieveNeighborhoodDocsResult> {
  const queryEmbedding = await embedText(input.topic);

  const rows = (await db
    .select({
      chunkText: neighborhoodDocs.chunkText,
      sourceTitle: neighborhoodDocs.sourceTitle,
      sourceUrl: neighborhoodDocs.sourceUrl,
      embedding: neighborhoodDocs.embedding,
    })
    .from(neighborhoodDocs)
    .where(eq(neighborhoodDocs.locality, input.locality))) as Row[];

  if (rows.length === 0) {
    return { chunks: [], uncertain: true };
  }

  const ranked = rows
    .map((row) => ({
      row,
      similarity: row.embedding ? cosineSimilarity(queryEmbedding, row.embedding) : -Infinity,
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, TOP_K)
    .map(({ row }) => ({
      chunkText: row.chunkText,
      sourceTitle: row.sourceTitle,
      sourceUrl: row.sourceUrl,
    }));

  return { chunks: ranked, uncertain: false };
}
