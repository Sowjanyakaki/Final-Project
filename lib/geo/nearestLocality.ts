/**
 * Fixed locality centroids matching the DEFAULT_LOCALITIES scope decided in
 * docs/superpowers/plans/2026-08-09-data-ingestion.md (the neighborhood RAG
 * corpus only covers these). bengaluru.rent's pin data carries lat/lng but
 * no locality name, so listings get tagged by proximity to this list
 * instead of guessing — anything farther than RADIUS_KM from all of them is
 * left as `null` rather than mis-tagged.
 */
export const DEFAULT_LOCALITIES = [
  { name: 'Koramangala', lat: 12.9352, lng: 77.6245 },
  { name: 'HSR Layout', lat: 12.9116, lng: 77.6412 },
  { name: 'Indiranagar', lat: 12.9784, lng: 77.6408 },
  { name: 'Whitefield', lat: 12.9698, lng: 77.75 },
  { name: 'Jayanagar', lat: 12.925, lng: 77.5938 },
] as const;

const RADIUS_KM = 3;
const EARTH_RADIUS_KM = 6371;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/**
 * Returns the name of the closest DEFAULT_LOCALITIES entry within RADIUS_KM,
 * or null if lat/lng is missing or nothing is close enough — missing
 * neighborhood-scope data should surface as "unknown", not a guess.
 */
export function nearestLocality(lat: number | null, lng: number | null): string | null {
  if (lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  let closest: { name: string; distanceKm: number } | null = null;
  for (const locality of DEFAULT_LOCALITIES) {
    const distanceKm = haversineKm(lat, lng, locality.lat, locality.lng);
    if (!closest || distanceKm < closest.distanceKm) {
      closest = { name: locality.name, distanceKm };
    }
  }

  return closest && closest.distanceKm <= RADIUS_KM ? closest.name : null;
}
