/**
 * Deterministic randomness for scene-one placement.
 *
 * Shelf targets, flashlight spots and haunt spawn choices must stay identical
 * across an interior remount (re-entering the building, retry after a WebGL
 * hiccup, or a scare that rebuilds the overlay). Feeding every draw with the
 * session seed plus a stable key keeps the result independent of call order.
 */

export function hashSeed(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick one entry from `items` deterministically for the given seed + key. */
export function pickSeeded<T>(seed: number, key: string, items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined;
  const random = createSeededRandom(hashSeed(`${seed}:${key}`));
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}
