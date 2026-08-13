import { Citation } from '../lib/types';

interface SourcesPanelProps {
  citations: Citation[];
}

function dedupeCitations(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  const result: Citation[] = [];
  for (const citation of citations) {
    const key = `${citation.label}|${citation.url ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(citation);
  }
  return result;
}

export default function SourcesPanel({ citations }: SourcesPanelProps) {
  const uniqueCitations = dedupeCitations(citations);

  if (uniqueCitations.length === 0) {
    return (
      <section aria-label="Sources" data-testid="sources-panel">
        <p data-testid="sources-empty">No sources cited yet.</p>
      </section>
    );
  }

  return (
    <section aria-label="Sources" data-testid="sources-panel">
      <ul>
        {uniqueCitations.map((citation) => (
          <li key={`${citation.label}|${citation.url ?? ''}`} data-testid="citation-item">
            <span data-testid="citation-kind">{citation.kind === 'rag' ? 'RAG' : 'OSM'}</span>{' '}
            {citation.kind === 'rag' && citation.url ? (
              <a href={citation.url} target="_blank" rel="noreferrer">
                {citation.label}
              </a>
            ) : (
              <span>{citation.label}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
