import * as THREE from "three";
import type { TheaterGameplayMeta } from "./theaterData";

/** Resolve an authored door before batching; never cut a nearby material batch. */
export function prepareTheaterDoorVisual(
  root: THREE.Group,
  door: TheaterGameplayMeta["mainDoor"],
  name: string,
): THREE.Object3D {
  const existing = root.getObjectByName(name);
  if (existing) return existing;
  const target = door.authoredVisualBounds;
  if (!target) throw new Error(`Missing authored bounds for ${name}`);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  let best: { object: THREE.Object3D; score: number } | undefined;
  root.traverse(object => {
    if (object === root || (object as THREE.Mesh).isMesh || !object.children.length) return;
    box.setFromObject(object);
    if (box.isEmpty()) return;
    const score = Math.abs(box.min.x - target.minX) + Math.abs(box.max.x - target.maxX)
      + Math.abs(box.min.y - target.minY) + Math.abs(box.max.y - target.maxY)
      + Math.abs(box.min.z - target.minZ) + Math.abs(box.max.z - target.maxZ);
    if (score > 0.03 || (best && best.score <= score)) return;
    best = { object, score };
  });
  if (!best) throw new Error(`Authored theater door not found: ${name}`);
  best.object.name = name;
  return best.object;
}

/** Imported ghost pivot is in its torso. Cache the foot offset, not a guessed Y. */
export function groundTheaterActor(actor: THREE.Object3D, floorY: number): number {
  actor.updateMatrixWorld(true);
  const footOffset = actor.position.y - new THREE.Box3().setFromObject(actor).min.y;
  actor.position.y = floorY + footOffset;
  return footOffset;
}

/**
 * Remove the two complete seat-row groups nearest the foyer before collision
 * projection and render batching flatten the authored hierarchy.
 */
export function removeTheaterAudienceRows(
  root: THREE.Group,
  bounds: TheaterGameplayMeta["removedAudienceRows"],
): THREE.Object3D[] {
  if (!bounds) return [];
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  const candidates: THREE.Object3D[] = [];
  root.traverse((object) => {
    // GLTFLoader represents authored transform-only row parents as Object3D,
    // while the lightweight offline probe uses Group. Match the semantic
    // parent node instead of a Three.js implementation type so the visual row
    // is removed in the browser as well as in tests.
    if (object === root || (object as THREE.Mesh).isMesh || object.children.length === 0 || !object.visible) return;
    box.setFromObject(object);
    box.getCenter(center);
    box.getSize(size);
    if (center.x < bounds.minX || center.x > bounds.maxX) return;
    if (center.y < bounds.minY || center.y > bounds.maxY) return;
    if (center.z < bounds.minZ || center.z > bounds.maxZ) return;
    if (size.x < (bounds.minRowSpanX ?? 10)) return;
    if (bounds.maxRowSpanX !== undefined && size.x > bounds.maxRowSpanX) return;
    if (size.z > (bounds.maxRowDepth ?? 2.2)) return;
    candidates.push(object);
  });

  const candidateSet = new Set(candidates);
  const rows = candidates.filter((candidate) => {
    let ancestor = candidate.parent;
    while (ancestor) {
      if (candidateSet.has(ancestor)) return false;
      ancestor = ancestor.parent;
    }
    return true;
  });
  for (const row of rows) row.removeFromParent();
  // SketchUp exported one narrow back-rest strip for the whole authored row
  // as a sibling of the left/centre/right seat groups. Removing the centre
  // group therefore leaves disconnected chair fragments visible even though
  // collision is already clear. Trim only triangles whose world-space centre
  // lies inside the requested centre section; the side blocks stay intact.
  const maxRowSpanX = bounds.maxRowSpanX;
  if (maxRowSpanX !== undefined) {
    root.updateMatrixWorld(true);
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.visible || Array.isArray(mesh.material)) return;
      const worldBox = new THREE.Box3().setFromObject(mesh);
      const worldSize = worldBox.getSize(new THREE.Vector3());
      const worldCenter = worldBox.getCenter(new THREE.Vector3());
      if (worldSize.x <= maxRowSpanX) return;
      if (worldSize.z > (bounds.maxRowDepth ?? 2.2)) return;
      if (worldCenter.y < bounds.minY || worldCenter.y > bounds.maxY) return;
      if (worldCenter.z < bounds.minZ || worldCenter.z > bounds.maxZ) return;
      pruneMeshTrianglesInsideBounds(mesh, bounds);
    });
  }
  return rows;
}

function pruneMeshTrianglesInsideBounds(
  mesh: THREE.Mesh,
  bounds: NonNullable<TheaterGameplayMeta["removedAudienceRows"]>,
): void {
  const source = mesh.geometry;
  if (source.groups.length > 1) return;
  const position = source.getAttribute("position");
  if (!position || position.itemSize < 3) return;
  const index = source.getIndex();
  const count = index?.count ?? position.count;
  if (count < 3 || count % 3 !== 0) return;

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const retained: number[] = [];
  let removedTriangles = 0;
  for (let offset = 0; offset < count; offset += 3) {
    const ia = index ? index.getX(offset) : offset;
    const ib = index ? index.getX(offset + 1) : offset + 1;
    const ic = index ? index.getX(offset + 2) : offset + 2;
    a.fromBufferAttribute(position, ia).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(position, ib).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(position, ic).applyMatrix4(mesh.matrixWorld);
    const x = (a.x + b.x + c.x) / 3;
    const y = (a.y + b.y + c.y) / 3;
    const z = (a.z + b.z + c.z) / 3;
    if (
      x >= bounds.minX && x <= bounds.maxX
      && y >= bounds.minY && y <= bounds.maxY
      && z >= bounds.minZ && z <= bounds.maxZ
    ) {
      removedTriangles++;
    } else {
      retained.push(ia, ib, ic);
    }
  }
  if (removedTriangles === 0) return;
  const geometry = source.clone();
  geometry.setIndex(retained);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  mesh.geometry = geometry;
  mesh.userData.theaterPrunedTriangles = removedTriangles;
}
