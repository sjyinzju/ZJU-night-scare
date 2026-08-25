import * as THREE from "three";
import type { MovementContext } from "./stateMachine/MovementContext";

const LOOK_SENSITIVITY = 0.0022;
const TOUCH_LOOK_SENSITIVITY = 0.005;
const PITCH_LIMIT = Math.PI / 2 - 0.05; // ~88.1°
const FOV_LERP_SPEED = 8;

/**
 * Handles camera rotation (yaw / pitch), FOV transitions, and subtle
 * head-bobbing for the interior first-person view.
 *
 * Extracted from Interior3D so the main orchestrator stays focused on
 * lifecycle and scene management.
 */
export class CameraController {
  private yaw = 0;
  private pitch = 0;
  private targetFov: number;
  private bobPhase = 0;
  private bobAmount = 0;
  private bobOffsetX = 0;
  private bobOffsetY = 0;
  private visualBobApplied = false;
  private readonly baseBobAmp = 0.018;
  private readonly sprintBobAmp = 0.038;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly isMobile: boolean,
  ) {
    this.targetFov = camera.fov;
  }

  /** Current horizontal look angle (radians). Used by the state machine to compute movement direction. */
  get currentYaw(): number {
    return this.yaw;
  }

  // ── Look input ──

  /** Desktop mouse look — called while pointer is locked. */
  addMouseLook(dx: number, dy: number): void {
    this.yaw -= dx * LOOK_SENSITIVITY;
    this.pitch -= dy * LOOK_SENSITIVITY;
    this.clampPitch();
    this.applyRotation();
  }

  /** Mobile touch-drag look. */
  addTouchLook(dx: number, dy: number): void {
    this.yaw -= dx * TOUCH_LOOK_SENSITIVITY;
    this.pitch -= dy * TOUCH_LOOK_SENSITIVITY;
    this.clampPitch();
    this.applyRotation();
  }

  /**
   * Directly set yaw (used by Interior3D to apply the blueprint's spawn
   * rotation).
   */
  setYaw(radians: number): void {
    this.yaw = radians;
    this.applyRotation();
  }

  /** Apply an authored horizontal and vertical view orientation. */
  setLook(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
    this.clampPitch();
    this.applyRotation();
  }

  // ── Per-frame update ──

  /**
   * Advance FOV towards target, update head-bob, and sync yaw to the
   * movement context so states can compute world-space movement direction.
   */
  update(dt: number, ctx: MovementContext, stateName: string): void {
    // FOV transition
    const target = stateName === "run" ? ctx.sprintFov : ctx.baseFov;
    if (Math.abs(this.camera.fov - target) > 0.01) {
      this.camera.fov += (target - this.camera.fov) * Math.min(1, dt * FOV_LERP_SPEED);
      this.camera.updateProjectionMatrix();
    }

    // Head bob
    const isMoving = ctx.velocity.x !== 0 || ctx.velocity.y !== 0;
    const isSprinting = stateName === "run";
    const targetBob = (isMoving && ctx.isOnGround) ? 1 : 0;
    const bobSpeed = isSprinting ? 2.8 : 1.8;
    this.bobAmount += (targetBob - this.bobAmount) * Math.min(1, dt * 6);

    this.bobOffsetX = 0;
    this.bobOffsetY = 0;
    if (this.bobAmount > 0.001) {
      const speed = isSprinting ? ctx.sprintSpeed : ctx.walkSpeed;
      this.bobPhase += dt * bobSpeed * speed * 0.6;
      const amp = (isSprinting ? this.sprintBobAmp : this.baseBobAmp) * this.bobAmount;
      this.bobOffsetY = Math.sin(this.bobPhase * 2) * amp;
      this.bobOffsetX = Math.cos(this.bobPhase) * amp * 0.4;
    }

    // Sync yaw to context so states can do world-space velocity math.
    ctx.yaw = this.yaw;
  }

  /** Apply the visual-only head bob immediately before rendering. */
  applyVisualBob(): void {
    if (this.visualBobApplied) return;
    this.camera.position.x += this.bobOffsetX;
    this.camera.position.y += this.bobOffsetY;
    this.visualBobApplied = true;
  }

  /** Restore the authoritative physical camera position after rendering. */
  clearVisualBob(): void {
    if (!this.visualBobApplied) return;
    this.camera.position.x -= this.bobOffsetX;
    this.camera.position.y -= this.bobOffsetY;
    this.visualBobApplied = false;
  }

  // ── internals ──

  private clampPitch(): void {
    this.pitch = THREE.MathUtils.clamp(this.pitch, -PITCH_LIMIT, PITCH_LIMIT);
  }

  private applyRotation(): void {
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);
  }
}
