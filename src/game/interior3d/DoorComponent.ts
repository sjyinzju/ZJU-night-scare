import * as THREE from "three";
import type { AABB } from "./buildRoom";

/**
 * An interactive hinged door inside a 3D interior.
 *
 * Features:
 * - Hinged rotation (open / close with lerp animation)
 * - Lockable (requires a key item ID; door stays shut until unlocked)
 * - Raycast-friendly: exposes its position and facing for interaction checks
 * - Auto-manages its collider (disabled while opening, re-enabled after close)
 *
 * Reference: Unity DoorScript.cs (Raycast + lock/key + rotation animation)
 */
export interface DoorConfig {
  /** World position of the door hinge (centre of the door panel). */
  hinge: THREE.Vector3;
  /** Width of the door panel along its local X axis, in metres. */
  width: number;
  /** Height of the door panel, in metres. */
  height: number;
  /** Rotation of the door around the Y axis at hinge (radians). 0 = faces +Z. */
  facing: number;
  /** Key item ID required to unlock.  Undefined → door is never locked. */
  keyItemId?: string;
  /** Maximum open angle (radians). Default 90°. */
  openAngle?: number;
  /** Rotation speed multiplier. Default 2.5. */
  speed?: number;
  /** Custom label shown in the interaction hint. */
  label?: string;
  /** Door body colour. */
  color?: number;
}

/**
 * The live door instance — call `update(dt)` every frame and
 * `interact(playerPos, inventory?)` when the player presses E.
 */
export class DoorComponent {
  readonly hinge: THREE.Vector3;
  readonly width: number;

  /** Group containing frame + panel. Add to the scene. */
  readonly group = new THREE.Group();
  /** Panel sub-group that actually rotates. */
  private readonly panelGroup = new THREE.Group();

  private _isOpen = false;
  private _isLocked: boolean;
  readonly keyItemId?: string;
  private targetAngle = 0;
  private currentAngle = 0;
  private readonly openAngle: number;
  private readonly speed: number;
  private label: string;

  /** Collider footprint while closed.  Removed when open. */
  readonly closedCollider: AABB;

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  constructor(config: DoorConfig) {
    this.hinge = config.hinge.clone();
    this.width = config.width;
    this.keyItemId = config.keyItemId;
    this._isLocked = config.keyItemId !== undefined;
    this.openAngle = config.openAngle ?? Math.PI / 2; // 90°
    this.speed = config.speed ?? 2.5;
    this.label = config.label ?? (this._isLocked ? "上锁的门" : "门");

    const h = config.height;
    const w = config.width;
    const t = 0.06; // panel thickness
    const color = config.color ?? 0x6b5a4a;

    this.group.position.copy(config.hinge);
    this.group.rotation.y = config.facing;

    // Frame
    const frameMat = this.trackMat(new THREE.MeshStandardMaterial({ color: 0x3a3028, roughness: 0.85 }));
    const frameL = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.08, h, 0.12)), frameMat);
    frameL.position.set(-w / 2, h / 2, 0);
    this.group.add(frameL);
    const frameR = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.08, h, 0.12)), frameMat);
    frameR.position.set(w / 2, h / 2, 0);
    this.group.add(frameR);
    const frameTop = new THREE.Mesh(this.track(new THREE.BoxGeometry(w + 0.16, 0.08, 0.12)), frameMat);
    frameTop.position.set(0, h, 0);
    this.group.add(frameTop);

    // Door panel (rotates around its left edge).
    const panelMat = this.trackMat(new THREE.MeshStandardMaterial({
      color,
      roughness: 0.75,
      metalness: 0.05,
    }));
    const panel = new THREE.Mesh(this.track(new THREE.BoxGeometry(w, h, t)), panelMat);
    panel.position.set(w / 2, h / 2, 0);
    this.panelGroup.add(panel);

    // Handle
    const handleMat = this.trackMat(new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.3, metalness: 0.8 }));
    const handle = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 8)), handleMat);
    handle.rotation.x = Math.PI / 2;
    handle.position.set(w - 0.1, h * 0.55, t / 2 + 0.05);
    this.panelGroup.add(handle);

    // Knob
    const knob = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.035, 8, 8)), handleMat);
    knob.position.set(w - 0.2, h * 0.55, t / 2 + 0.06);
    this.panelGroup.add(knob);

    // Pivot: rotation happens around the left edge (x = 0 in panelGroup space).
    this.panelGroup.position.set(0, 0, 0);
    this.group.add(this.panelGroup);

    // Lock indicator (small red/green dot above the handle).
    const indicatorMat = this.trackMat(new THREE.MeshStandardMaterial({
      color: this._isLocked ? 0xcc3333 : 0x33aa55,
      emissive: this._isLocked ? 0x440000 : 0x003300,
      emissiveIntensity: 0.6,
      roughness: 0.5,
    }));
    const indicator = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.04, 8, 8)), indicatorMat);
    indicator.position.set(w - 0.1, h * 0.72, t / 2 + 0.04);
    this.panelGroup.add(indicator);

    // Approximate collider when closed.
    const hw = w / 2;
    const cosF = Math.cos(config.facing);
    const sinF = Math.sin(config.facing);
    const cx = config.hinge.x;
    const cz = config.hinge.z;
    const dx = w * Math.abs(cosF) + 0.1;
    const dz = w * Math.abs(sinF) + 0.1;
    this.closedCollider = { minX: cx - dx / 2, maxX: cx + dx / 2, minZ: cz - dz / 2, maxZ: cz + dz / 2 };
  }

  get isOpen(): boolean { return this._isOpen; }
  get isLocked(): boolean { return this._isLocked; }
  get interactionLabel(): string { return this.label; }

  /**
   * Attempt to open / close / unlock the door.
   * @param playerPos   World position of the player's camera.
   * @param inventory   Array of item IDs the player holds (for key checks).
   * @param maxDistance Max interaction distance.
   */
  interact(playerPos: THREE.Vector3, inventory: string[] = [], maxDistance = 2.5): string | null {
    const dist = playerPos.distanceTo(this.hinge);
    if (dist > maxDistance) return null;

    if (this._isLocked && this.keyItemId) {
      if (inventory.includes(this.keyItemId)) {
        this._isLocked = false;
        this.label = "门";
        return "门禁卡刷过，锁咔哒一声弹开了。";
      }
      return "锁住了，需要门禁卡。";
    }

    if (this._isOpen) {
      this.targetAngle = 0;
      this._isOpen = false;
      this.label = this.keyItemId ? "门" : "门";
      return null;
    } else {
      this.targetAngle = this.openAngle;
      this._isOpen = true;
      this.label = "门（按 E 关上）";
      return null;
    }
  }

  update(dt: number): void {
    const prev = this.currentAngle;
    this.currentAngle += (this.targetAngle - this.currentAngle) * Math.min(1, this.speed * dt);
    if (Math.abs(this.currentAngle - this.targetAngle) < 0.002) {
      this.currentAngle = this.targetAngle;
    }
    if (this.currentAngle !== prev) {
      this.panelGroup.rotation.y = this.currentAngle;
    }
  }

  /** Free GPU resources. */
  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.group.clear();
  }

  private track<T extends THREE.BufferGeometry>(g: T): T { this.geometries.push(g); return g; }
  private trackMat<T extends THREE.Material>(m: T): T { this.materials.push(m); return m; }
}
