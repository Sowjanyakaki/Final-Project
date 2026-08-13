import { NeighborhoodSnapshot, SourcedClaim } from '../lib/types';

interface NeighborhoodPanelProps {
  snapshot: NeighborhoodSnapshot;
}

type SectionKey = 'transit' | 'safety' | 'amenities';

const SECTION_LABELS: Record<SectionKey, string> = {
  transit: 'Transit',
  safety: 'Safety',
  amenities: 'Amenities',
};

function Section({
  id,
  title,
  claims,
  isUncertain,
}: {
  id: SectionKey;
  title: string;
  claims: SourcedClaim[];
  isUncertain: boolean;
}) {
  const showUnavailable = isUncertain || claims.length === 0;

  return (
    <div data-testid={`${id}-section`}>
      <h3>{title}</h3>
      {showUnavailable ? (
        <p data-testid={`${id}-unavailable`}>Data unavailable for this area.</p>
      ) : (
        <ul>
          {claims.map((claim, index) => (
            <li key={`${id}-${index}`}>
              <span>{claim.text}</span>
              <span data-testid={`${id}-source-${index}`}> — {claim.source}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function NeighborhoodPanel({ snapshot }: NeighborhoodPanelProps) {
  return (
    <section aria-label="Neighborhood snapshot" data-testid="neighborhood-panel">
      <Section
        id="transit"
        title={SECTION_LABELS.transit}
        claims={snapshot.transit}
        isUncertain={Boolean(snapshot.uncertain?.transit)}
      />
      <Section
        id="safety"
        title={SECTION_LABELS.safety}
        claims={snapshot.safety}
        isUncertain={Boolean(snapshot.uncertain?.safety)}
      />
      <Section
        id="amenities"
        title={SECTION_LABELS.amenities}
        claims={snapshot.amenities}
        isUncertain={Boolean(snapshot.uncertain?.amenities)}
      />
    </section>
  );
}
