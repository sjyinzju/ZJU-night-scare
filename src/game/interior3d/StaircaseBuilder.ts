import * as THREE from "three";
import type { AABB } from "./buildRoom";

/**
 * Reusable staircase generators for multi-floor interiors.
 *
 * Three types:
 * - "straight":  a single flight, good for dorm corridors, basements.
 * - "L":         two flights with a landing, good for tighter spaces.
 * - "spiral":    already handled inside buildRoom.ts (library); this
 *                builder does NOT replace that one.
 *
 * Each builder returns:
 * - root: THREE.Group     → add to the scene
 * - colliders: AABB[]     → merge into the room's collider array
 * - floorHeightFn: (x, z) → number  → merge into the room's floorHeightAt
 * - upstairsBounds: AABB   → the playable area on the upper floor
 * - upstairsY: number      → ground height of the upper floor
 */
export interface StaircaseResult {
  root: THREE.Group;
  colliders: AABB[];
  /** Returns floor height contribution from this staircase segment. */
  floorHeightAt: (x: number, z: number) => number;
  /** Playable bounds for the upper floor. */
  upstairsBounds: AABB;
  /** Ground height of the upper floor, in world Y. */
  upstairsY: number;
  dispose: () => void;
}

// ── straight staircase ──

export function buildStraightStairs(params: {
  /** Bottom-centre of the first step (XZ). */
  baseX: number;
  baseZ: number;
  /** Direction the stairs go (normalised XZ vector).  E.g. {x:0, z:-1} = -Z. */
  dirX: number;
  dirZ: number;
  /** Number of steps. */
  steps: number;
  /** Height of each step (m). Default 0.18 → comfortable indoor stairs. */
  stepHeight?: number;
  /** Depth (tread) of each step (m). Default 0.3. */
  stepDepth?: number;
  /** Width of the stairs (m). Default 1.2. */
  width?: number;
  /** Material colour for the steps. */
  color?: number;
}): StaircaseResult {
  const sh = params.stepHeight ?? 0.18;
  const sd = params.stepDepth ?? 0.3;
  const w = params.width ?? 1.2;
  const n = params.steps;
  const color = params.color ?? 0x8a8a8a;
  const totalH = n * sh;
  const totalD = n * sd;

  const root = new THREE.Group();
  const colliders: AABB[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });

  const dx = params.dirX;
  const dz = params.dirZ;
  // Perpendicular (for the width axis).
  const px = -dz;
  const pz = dx;

  for (let i = 0; i < n; i++) {
    const cx = params.baseX + dx * (i + 0.5) * sd;
    const cz = params.baseZ + dz * (i + 0.5) * sd;
    const cy = (i + 0.5) * sh;

    const stepGeo = new THREE.BoxGeometry(w, sh, sd);
    geos.push(stepGeo);
    const step = new THREE.Mesh(stepGeo, mat);
    step.position.set(cx, cy, cz);
    step.rotation.y = Math.atan2(dx, dz);
    step.castShadow = true;
    step.receiveShadow = true;
    root.add(step);

    // Collider per step.
    const hw = w / 2;
    const hd = sd / 2;
    colliders.push({
      minX: cx - hw * Math.abs(px) - hd * Math.abs(dx),
      maxX: cx + hw * Math.abs(px) + hd * Math.abs(dx),
      minZ: cz - hw * Math.abs(pz) - hd * Math.abs(dz),
      maxZ: cz + hw * Math.abs(pz) + hd * Math.abs(dz),
    });
  }

  // Side rails.
  const railMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.6, metalness: 0.5 });
  for (const side of [-1, 1]) {
    const rx = params.baseX + px * side * (w / 2 - 0.06);
    const rz = params.baseZ + pz * side * (w / 2 - 0.06);
    const railGeo = new THREE.BoxGeometry(0.06, totalH, totalD);
    geos.push(railGeo);
    const rail = new THREE.Mesh(railGeo, railMat);
    rail.position.set(rx + dx * totalD / 2, totalH / 2, rz + dz * totalD / 2);
    rail.rotation.y = Math.atan2(dx, dz);
    root.add(rail);
    // Rail collider
    colliders.push({
      minX: rx - 0.06, maxX: rx + 0.06,
      minZ: rz - 0.06, maxZ: rz + 0.06,
    });
  }

  // Floor height function.
  const floorHeightAt = (x: number, z: number): number => {
    // Project position onto the stair direction.
    const relX = x - params.baseX;
    const relZ = z - params.baseZ;
    const proj = relX * dx + relZ * dz;
    if (proj < 0 || proj > totalD) return 0;
    const t = proj / totalD;
    return t * totalH;
  };

  // Upper bounds: everything past the top step at height totalH.
  const ubW = 3.0; // generous walkable area at the top
  const upstairsBounds: AABB = {
    minX: params.baseX + dx * totalD - ubW / 2,
    maxX: params.baseX + dx * totalD + ubW / 2,
    minZ: params.baseZ + dz * totalD - ubW / 2,
    maxZ: params.baseZ + dz * totalD + ubW / 2,
  };

  return {
    root,
    colliders,
    floorHeightAt,
    upstairsBounds,
    upstairsY: totalH,
    dispose: () => { for (const g of geos) g.dispose(); for (const m of mats) m.dispose(); root.clear(); },
  };
}

// ── L-shaped staircase (two flights + landing) ──

export function buildLStairs(params: {
  baseX: number; baseZ: number;
  dir1X: number; dir1Z: number; steps1: number;   // first flight
  dir2X: number; dir2Z: number; steps2: number;   // second flight (perpendicular to first)
  stepHeight?: number; stepDepth?: number; width?: number; color?: number;
}): StaircaseResult {
  const sh = params.stepHeight ?? 0.18;
  const sd = params.stepDepth ?? 0.3;
  const w = params.width ?? 1.2;
  const color = params.color ?? 0x8a8a8a;

  const root = new THREE.Group();
  const colliders: AABB[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });

  // Flight 1
  const end1X = params.baseX + params.dir1X * params.steps1 * sd;
  const end1Z = params.baseZ + params.dir1Z * params.steps1 * sd;
  const landingY = params.steps1 * sh;

  for (let i = 0; i < params.steps1; i++) {
    const cx = params.baseX + params.dir1X * (i + 0.5) * sd;
    const cz = params.baseZ + params.dir1Z * (i + 0.5) * sd;
    const cy = (i + 0.5) * sh;
    const stepGeo = new THREE.BoxGeometry(w, sh, sd);
    geos.push(stepGeo);
    const step = new THREE.Mesh(stepGeo, mat);
    step.position.set(cx, cy, cz);
    step.rotation.y = Math.atan2(params.dir1X, params.dir1Z);
    root.add(step);
    colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - sd / 2, maxZ: cz + sd / 2 });
  }

  // Landing
  const landingGeo = new THREE.BoxGeometry(w + 0.3, 0.12, w + 0.3);
  geos.push(landingGeo);
  const landing = new THREE.Mesh(landingGeo, mat);
  landing.position.set(end1X, landingY, end1Z);
  root.add(landing);
  colliders.push({ minX: end1X - w / 2 - 0.2, maxX: end1X + w / 2 + 0.2, minZ: end1Z - w / 2 - 0.2, maxZ: end1Z + w / 2 + 0.2 });

  // Flight 2
  const totalH = landingY + params.steps2 * sh;
  for (let i = 0; i < params.steps2; i++) {
    const cx = end1X + params.dir2X * (i + 0.5) * sd;
    const cz = end1Z + params.dir2Z * (i + 0.5) * sd;
    const cy = landingY + (i + 0.5) * sh;
    const stepGeo = new THREE.BoxGeometry(w, sh, sd);
    geos.push(stepGeo);
    const step = new THREE.Mesh(stepGeo, mat);
    step.position.set(cx, cy, cz);
    step.rotation.y = Math.atan2(params.dir2X, params.dir2Z);
    root.add(step);
    colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - sd / 2, maxZ: cz + sd / 2 });
  }

  const end2X = end1X + params.dir2X * params.steps2 * sd;
  const end2Z = end1Z + params.dir2Z * params.steps2 * sd;

  const floorHeightAt = (x: number, z: number): number => {
    const proj1 = (x - params.baseX) * params.dir1X + (z - params.baseZ) * params.dir1Z;
    const len1 = params.steps1 * sd;
    if (proj1 >= 0 && proj1 <= len1) return (proj1 / len1) * landingY;
    const proj2 = (x - end1X) * params.dir2X + (z - end1Z) * params.dir2Z;
    const len2 = params.steps2 * sd;
    if (proj2 >= 0 && proj2 <= len2) return landingY + (proj2 / len2) * (totalH - landingY);
    return 0;
  };

  const ubW = 3.0;
  return {
    root,
    colliders,
    floorHeightAt,
    upstairsBounds: { minX: end2X - ubW / 2, maxX: end2X + ubW / 2, minZ: end2Z - ubW / 2, maxZ: end2Z + ubW / 2 },
    upstairsY: totalH,
    dispose: () => { for (const g of geos) g.dispose(); root.clear(); },
  };
}
