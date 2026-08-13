import { pipeline } from '@xenova/transformers';

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIM = 384;

// @xenova/transformers's generated types resolve `pipeline()`'s return type
// to a huge union across every pipeline task (since MODEL_NAME is a runtime
// string, not a literal), which doesn't type-check against how a
// feature-extraction pipeline is actually called. Cast once at this single
// boundary to the minimal shape this file actually relies on.
type FeatureExtractor = (
  text: string,
  options: { pooling: 'mean'; normalize: boolean }
) => Promise<{ data: ArrayLike<number> }>;

// Lazily created once per process, then reused — loading the model on every
// call would be far too slow for ingesting hundreds of chunks/listings.
let extractorPromise: Promise<FeatureExtractor> | null = null;

function getExtractor(): Promise<FeatureExtractor> {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', MODEL_NAME) as unknown as Promise<FeatureExtractor>;
  }
  return extractorPromise;
}

/**
 * Embeds text locally via a MiniLM sentence-embedding model (no external API
 * call). Output is mean-pooled, L2-normalized, and defensively shaped to
 * exactly 384 dims to match the `neighborhood_docs.embedding` column,
 * regardless of what the underlying model happens to return.
 */
export async function embedText(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  const raw = Array.from(output.data as ArrayLike<number>);

  if (raw.length === EMBEDDING_DIM) {
    return raw;
  }
  if (raw.length > EMBEDDING_DIM) {
    return raw.slice(0, EMBEDDING_DIM);
  }
  return [...raw, ...new Array(EMBEDDING_DIM - raw.length).fill(0)];
}
