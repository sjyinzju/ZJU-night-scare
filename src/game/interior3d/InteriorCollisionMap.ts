import * as THREE from "three";
import type { AABB } from "./buildRoom";

export type InteriorObstacleKind = "wall" | "shelf" | "furniture";

export interface InteriorMapObstacle extends AABB {
  kind: InteriorObstacleKind;
}

export interface InteriorCollisionMap {
  bounds: AABB;
  obstacles: InteriorMapObstacle[];
}

const CELL_SIZE = 0.1;
const FLOOR_CUTOFF = 0.16;
const WALKER_TOP = 1.45;

function setCell(
  cells: Uint8Array,
  columns: number,
  rows: number,
  bounds: AABB,
  x: number,
  z: number,
  weight: number,
): void {
  const column = Math.floor((x - bounds.minX) / CELL_SIZE);
  const row = Math.floor((z - bounds.minZ) / CELL_SIZE);
  if (column < 0 || column >= columns || row < 0 || row >= rows) return;
  const index = row * columns + column;
  cells[index] = Math.max(cells[index], weight);
}

function pointInTriangle(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
): boolean {
  const d1 = (px - bx) * (az - bz) - (ax - bx) * (pz - bz);
  const d2 = (px - cx) * (bz - cz) - (bx - cx) * (pz - cz);
  const d3 = (px - ax) * (cz - az) - (cx - ax) * (pz - az);
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNegative && hasPositive);
}

function rasterizeEdge(
  cells: Uint8Array,
  columns: number,
  rows: number,
  bounds: AABB,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  weight: number,
): void {
  const distance = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.ceil(distance / (CELL_SIZE * 0.45)));
  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    setCell(cells, columns, rows, bounds, THREE.MathUtils.lerp(ax, bx, t), THREE.MathUtils.lerp(az, bz, t), weight);
  }
}

function rasterizeTriangle(
  cells: Uint8Array,
  columns: number,
  rows: number,
  bounds: AABB,
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  weight: number,
): void {
  rasterizeEdge(cells, columns, rows, bounds, a.x, a.z, b.x, b.z, weight);
  rasterizeEdge(cells, columns, rows, bounds, b.x, b.z, c.x, c.z, weight);
  rasterizeEdge(cells, columns, rows, bounds, c.x, c.z, a.x, a.z, weight);

  const area = Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z));
  if (area < 0.002) return;
  const minColumn = THREE.MathUtils.clamp(Math.floor((Math.min(a.x, b.x, c.x) - bounds.minX) / CELL_SIZE), 0, columns - 1);
  const maxColumn = THREE.MathUtils.clamp(Math.floor((Math.max(a.x, b.x, c.x) - bounds.minX) / CELL_SIZE), 0, columns - 1);
  const minRow = THREE.MathUtils.clamp(Math.floor((Math.min(a.z, b.z, c.z) - bounds.minZ) / CELL_SIZE), 0, rows - 1);
  const maxRow = THREE.MathUtils.clamp(Math.floor((Math.max(a.z, b.z, c.z) - bounds.minZ) / CELL_SIZE), 0, rows - 1);
  for (let row = minRow; row <= maxRow; row++) {
    const z = bounds.minZ + (row + 0.5) * CELL_SIZE;
    for (let column = minColumn; column <= maxColumn; column++) {
      const x = bounds.minX + (column + 0.5) * CELL_SIZE;
      if (pointInTriangle(x, z, a.x, a.z, b.x, b.z, c.x, c.z)) {
        const index = row * columns + column;
        cells[index] = Math.max(cells[index], weight);
      }
    }
  }
}

function classifyObstacle(size: THREE.Vector3): InteriorObstacleKind {
  const longSide = Math.max(size.x, size.z);
  const shortSide = Math.min(size.x, size.z);
  if (
    size.y >= 2 &&
    size.y <= 4.5 &&
    longSide >= 1.1 &&
    longSide <= 3.2 &&
    shortSide >= 0.3 &&
    shortSide <= 1.8
  ) {
    return "shelf";
  }
  if (size.y > 1.7 || longSide > 3.2 || shortSide < 0.28) return "wall";
  return "furniture";
}

function obstacleWeight(kind: InteriorObstacleKind): number {
  if (kind === "wall") return 3;
  if (kind === "shelf") return 2;
  return 1;
}

function obstacleKind(weight: number): InteriorObstacleKind {
  if (weight === 3) return "wall";
  if (weight === 2) return "shelf";
  return "furniture";
}

/**
 * Projects first-floor GLB meshes into a compact XZ occupancy map. The same
 * rectangles drive movement collision and the in-game floor plan, preventing
 * the two representations from drifting apart.
 */
export function buildInteriorCollisionMap(root: THREE.Object3D, modelBounds: THREE.Box3): InteriorCollisionMap {
  const bounds: AABB = {
    minX: modelBounds.min.x,
    maxX: modelBounds.max.x,
    minZ: modelBounds.min.z,
    maxZ: modelBounds.max.z,
  };
  const spanX = Math.max(CELL_SIZE, bounds.maxX - bounds.minX);
  const spanZ = Math.max(CELL_SIZE, bounds.maxZ - bounds.minZ);
  const columns = Math.ceil(spanX / CELL_SIZE);
  const rows = Math.ceil(spanZ / CELL_SIZE);
  const cells = new Uint8Array(columns * rows);
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();

  root.updateMatrixWorld(true);
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    const position = mesh.geometry.getAttribute("position");
    if (!position) return;
    box.setFromObject(mesh);
    // Exact broad-phase rejection: meshes wholly below the collision slice or
    // above the player's head cannot contribute any accepted triangle. Large
    // authored ceilings and upper structures are skipped without changing the
    // 10 cm occupancy result.
    if (box.max.y <= FLOOR_CUTOFF || box.min.y >= WALKER_TOP) return;
    box.getSize(size);
    const kind = classifyObstacle(size);
    const weight = obstacleWeight(kind);
    const index = mesh.geometry.getIndex();
    const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3);
    for (let triangle = 0; triangle < triangleCount; triangle++) {
      const ia = index ? index.getX(triangle * 3) : triangle * 3;
      const ib = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1;
      const ic = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2;
      a.fromBufferAttribute(position as THREE.BufferAttribute, ia).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(position as THREE.BufferAttribute, ib).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(position as THREE.BufferAttribute, ic).applyMatrix4(mesh.matrixWorld);
      const maxY = Math.max(a.y, b.y, c.y);
      const minY = Math.min(a.y, b.y, c.y);
      if (maxY <= FLOOR_CUTOFF || minY >= WALKER_TOP) continue;
      rasterizeTriangle(cells, columns, rows, bounds, a, b, c, weight);
    }
  });

  // Merge equal horizontal runs through consecutive rows. This keeps runtime
  // collision checks small while preserving 10 cm map detail.
  const obstacles: InteriorMapObstacle[] = [];
  let active = new Map<string, { startRow: number; endRow: number; startColumn: number; endColumn: number; weight: number }>();
  for (let row = 0; row < rows; row++) {
    const next = new Map<string, { startRow: number; endRow: number; startColumn: number; endColumn: number; weight: number }>();
    let column = 0;
    while (column < columns) {
      const weight = cells[row * columns + column];
      if (weight === 0) {
        column++;
        continue;
      }
      const startColumn = column;
      while (column + 1 < columns && cells[row * columns + column + 1] === weight) column++;
      const endColumn = column;
      const key = `${weight}:${startColumn}:${endColumn}`;
      const previous = active.get(key);
      next.set(key, previous
        ? { ...previous, endRow: row }
        : { startRow: row, endRow: row, startColumn, endColumn, weight });
      column++;
    }

    for (const [key, rect] of active) {
      if (!next.has(key)) obstacles.push(toObstacle(rect, bounds));
    }
    active = next;
  }
  for (const rect of active.values()) obstacles.push(toObstacle(rect, bounds));

  return { bounds, obstacles };
}

function toObstacle(
  rect: { startRow: number; endRow: number; startColumn: number; endColumn: number; weight: number },
  bounds: AABB,
): InteriorMapObstacle {
  const kind = obstacleKind(rect.weight);
  // Furniture is assembled from many close-set pieces. Shrinking its grid
  // footprint by one cell preserves real chair/table gaps without letting
  // the player pass through walls or shelf bodies.
  const inset = kind === "furniture" ? CELL_SIZE : 0;
  const rawMinX = bounds.minX + rect.startColumn * CELL_SIZE;
  const rawMaxX = Math.min(bounds.maxX, bounds.minX + (rect.endColumn + 1) * CELL_SIZE);
  const rawMinZ = bounds.minZ + rect.startRow * CELL_SIZE;
  const rawMaxZ = Math.min(bounds.maxZ, bounds.minZ + (rect.endRow + 1) * CELL_SIZE);
  return {
    minX: Math.min((rawMinX + rawMaxX) / 2, rawMinX + inset),
    maxX: Math.max((rawMinX + rawMaxX) / 2, rawMaxX - inset),
    minZ: Math.min((rawMinZ + rawMaxZ) / 2, rawMinZ + inset),
    maxZ: Math.max((rawMinZ + rawMaxZ) / 2, rawMaxZ - inset),
    kind,
  };
}
