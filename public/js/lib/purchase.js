// Whether a signed-in owner's purchase rows cover this studio and year.
// studio_key is normalizeStudioName, the same key the webhook stores.
import { normalizeStudioName } from './unlock.js';

export function purchaseCovers(purchases, studioName, year) {
  const key = normalizeStudioName(studioName);
  const y = Number(year);
  if (!key || !Number.isInteger(y)) return false;
  return (purchases || []).some((p) => p && p.status === 'paid' && p.studio_key === key && Number(p.year) === y);
}
