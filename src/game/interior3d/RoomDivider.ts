import * as THREE from "three";
import { DoorComponent, type DoorConfig } from "./DoorComponent";
import type { AABB } from "./buildRoom";

/**
 * A wall that subdivides a room, optionally containing a door.
 *
 * Usage:
 * ```ts
 * const divider = new RoomDivider({
 *   startX, startZ, endX, endZ, wallHeight: 3.2,
 *   door: { position: 0.65, keyItemId: "key_card", label: "档案室门" },
 * });
 * scene.add(divider.group);
 * colliders.push(divider.wallCollider);
 * ```
 */
export interface RoomDividerConfig {
  /** Wall start point (XZ). */
  startX: number;
  startZ: number;
  /** Wall end point (XZ). */
  endX: number;
  endZ: number;
  /** Wall height in metres. */
  wallHeight: number;
  /** Wall thickness. Default 0.2. */
  thickness?: number;
  /** Wall colour. */
  color?: number;
  /** Door configuration. If provided, a door is placed in the wall. */
  door?: {
    /** Fractional position along the wall (0-1). Default 0.5. */
    position?: number;
    /** Door width. Default 1.0. */
    width?: number;
    /** Door height. Default 2.2. */
    height?: number;
    /** Key item ID if the door is locked. */
    keyItemId?: string;
    /** Door label for interaction hint. */
    label?: string;
  };
}

export class RoomDivider {
  readonly group = new THREE.Group();
  /** The wall collider (AABB of the wall segments, excluding the door gap). */
  readonly wallColliders: AABB[] = [];
  /** The door (undefined if no door configured). */
  readonly door?: DoorComponent;

  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];

  constructor(config: RoomDividerConfig) {
    const t = config.thickness ?? 0.2;
    const color = config.color ?? 0x3b3a3f;
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
    this.mats.push(mat);
    const th = config.wallHeight;

    const dx = config.endX - config.startX;
    const dz = config.endZ - config.startZ;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return; // degenerate

    const ndx = dx / len;
    const ndz = dz / len;
    const pnx = -ndz; // perpendicular
    const pnz = ndx;
    const angle = Math.atan2(ndx, ndz);

    const doorPos = config.door?.position ?? 0.5;
    const doorWidth = config.door?.width ?? 1.0;
    const doorHeight = config.door?.height ?? 2.2;
    const doorCenter = doorPos * len;
    const halfDw = doorWidth / 2;

    // Build wall segments: one before the door, one after.
    const segments: [number, number][] = [];
    if (config.door) {
      const seg1End = doorCenter - halfDw;
      if (seg1End > 0.05) segments.push([0, seg1End]);
      const seg2Start = doorCenter + halfDw;
      if (seg2Start < len - 0.05) segments.push([seg2Start, len]);
    } else {
      segments.push([0, len]);
    }

    for (const [segStart, segEnd] of segments) {
      const segLen = segEnd - segStart;
      if (segLen <= 0) continue;
      const segMid = (segStart + segEnd) / 2;
      const cx = config.startX + ndx * segMid;
      const cz = config.startZ + ndz * segMid;

      const segGeo = new THREE.BoxGeometry(segLen, th, t);
      this.geos.push(segGeo);
      const seg = new THREE.Mesh(segGeo, mat);
      seg.position.set(cx, th / 2, cz);
      seg.rotation.y = angle;
      seg.castShadow = true;
      seg.receiveShadow = true;
      this.group.add(seg);

      // Collider
      const hw = segLen / 2 + 0.06;
      const hd = t / 2 + 0.06;
      this.wallColliders.push({
        minX: cx - hw * Math.abs(ndx) - hd * Math.abs(pnx),
        maxX: cx + hw * Math.abs(ndx) + hd * Math.abs(pnx),
        minZ: cz - hw * Math.abs(ndz) - hd * Math.abs(pnz),
        maxZ: cz + hw * Math.abs(ndz) + hd * Math.abs(pnz),
      });
    }

    // Door
    if (config.door) {
      const dcx = config.startX + ndx * doorCenter;
      const dcz = config.startZ + ndz * doorCenter;
      const doorCfg: DoorConfig = {
        hinge: new THREE.Vector3(dcx, 0, dcz),
        width: doorWidth,
        height: doorHeight,
        facing: angle,
        keyItemId: config.door.keyItemId,
        label: config.door.label ?? (config.door.keyItemId ? "上锁的门" : "门"),
      };
      this.door = new DoorComponent(doorCfg);
      this.group.add(this.door.group);
    }
  }

  update(dt: number): void {
    this.door?.update(dt);
  }

  /** Maximum interaction distance for the door, used by Interior3D. */
  get doorInteractionDistance(): number {
    return 2.5;
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.door?.dispose();
    this.group.clear();
  }
}
