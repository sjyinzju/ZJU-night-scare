export const EXTERIOR_AUTO_INTERACTION_RADIUS = 1.05;

/**
 * All authored exterior story hotspot modes share the same close-range safety
 * trigger. The larger hotspot radius remains the manual E interaction range.
 */
export function shouldAutoTriggerExteriorHotspot(
  distance: number,
  hotspotRadius: number,
): boolean {
  return distance <= Math.min(EXTERIOR_AUTO_INTERACTION_RADIUS, hotspotRadius);
}
