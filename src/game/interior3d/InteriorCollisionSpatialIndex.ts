import type { AABB } from "./buildRoom";

/**
 * Broad-phase lookup for dense authored interiors. Colliders are inserted into
 * every cell touched by their player-padded bounds, so querying one point is
 * exactly equivalent to scanning the full array before the narrow AABB test.
 */
export class AabbSpatialIndex {
  private readonly cells = new Map<string, AABB[]>();

  constructor(
    colliders: readonly AABB[],
    private readonly cellSize: number,
    padding: number,
  ) {
    for (const collider of colliders) {
      const minX = Math.floor((collider.minX - padding) / cellSize);
      const maxX = Math.floor((collider.maxX + padding) / cellSize);
      const minZ = Math.floor((collider.minZ - padding) / cellSize);
      const maxZ = Math.floor((collider.maxZ + padding) / cellSize);
      for (let cellX = minX; cellX <= maxX; cellX++) {
        for (let cellZ = minZ; cellZ <= maxZ; cellZ++) {
          const key = `${cellX}:${cellZ}`;
          const entries = this.cells.get(key);
          if (entries) entries.push(collider);
          else this.cells.set(key, [collider]);
        }
      }
    }
  }

  query(x: number, z: number): readonly AABB[] {
    return this.cells.get(`${Math.floor(x / this.cellSize)}:${Math.floor(z / this.cellSize)}`) ?? [];
  }
}
