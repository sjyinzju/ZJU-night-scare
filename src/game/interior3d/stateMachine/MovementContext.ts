import type * as THREE from "three";
import type { AABB } from "../buildRoom";
import type { InteriorMovementProfile } from "../interiorBlueprints";

// ── Input ────────────────────────────────────────────────────────────────

/**
 * Normalised snapshot of player intent for the current frame.
 * Populated by InputManager before the state machine runs.
 */
export interface InputSnapshot {
  /** Horizontal strafe: -1 (left) … 1 (right). */
  moveX: number;
  /** Forward/back: -1 (backward) … 1 (forward). */
  moveZ: number;
  /** True on the frame the jump key transitions from released → pressed. */
  jumpPressed: boolean;
  /** True while the jump key is held down. */
  jumpHeld: boolean;
  /** True while the sprint modifier is held. */
  sprintHeld: boolean;
  /** True while the crouch modifier is held. */
  crouchHeld: boolean;
}

// ── Context ──────────────────────────────────────────────────────────────

/**
 * Shared, mutable per-frame context that every movement state reads and
 * writes.  Owned by Interior3D and passed through the state machine on
 * each tick.
 *
 * Design: keep the context flat so states only touch the fields they care
 * about.  Velocity is a mutable object shared across states — the state
 * machine itself never touches it directly.
 */
export interface MovementContext {
  // ── Physics ──
  /** Horizontal velocity (x = world-right, y = velocity.z alias — kept as 2D for legacy collision compat). */
  velocity: { x: number; y: number };
  /** Vertical velocity (world-up). Positive = moving up. */
  velocityY: number;
  /** True when the player is standing on a surface this frame. */
  isOnGround: boolean;
  /** `isOnGround` value from the previous frame. Used for coyote-time & landing detection. */
  wasOnGround: boolean;

  // ── Collision helpers (bound to the current room) ──
  /** Test whether placing the player at (x, y-feet, z) would overlap a collider. */
  collidesAt: (x: number, y: number, z: number) => boolean;
  /** The playable area for this room. */
  bounds: AABB;
  /** Radius of the player cylinder used for collision. */
  playerRadius: number;
  /** Current floor height from the room (0 on ground, >0 on stairs / mezzanine). */
  floorHeightAt: (x: number, z: number) => number;

  // ── Input snapshot (refreshed every frame) ──
  input: InputSnapshot;

  // ── Camera ──
  camera: THREE.PerspectiveCamera;
  /** Horizontal look angle in radians. */
  yaw: number;

  // ── Speed / accel params (populated from blueprint) ──
  walkSpeed: number;
  sprintSpeed: number;
  crouchSpeed: number;
  /** Acceleration when input direction ≈ velocity direction. */
  accel: number;
  /** Deceleration when input opposes velocity (or released). */
  decel: number;
  /** Multiplier applied to accel/decel while airborne. */
  airControl: number;

  // ── Jump params ──
  /** Initial upward velocity impulse on jump. */
  jumpVelocity: number;
  /** Gravity while velocityY > 0 (rising). */
  jumpGravity: number;
  /** Gravity while velocityY <= 0 (falling). */
  fallGravity: number;
  /** Multiplier on jumpGravity when the player releases jump early. */
  jumpCutMultiplier: number;
  /** How many additional jumps are allowed while airborne (0 = single jump). */
  maxAirJumps: number;
  /** Grace period after walking off a ledge where jump is still allowed (seconds). */
  coyoteTime: number;
  /** Window before landing where a jump press is remembered (seconds). */
  jumpBufferTime: number;

  // ── State-owned timers (mutated by states) ──
  /** Remaining air jumps this flight. Reset to maxAirJumps on landing. */
  airJumpsLeft: number;
  /** Coyote timer — counts down from coyoteTime while falling off a ledge. */
  coyoteTimer: number;
  /** Jump-buffer timer — counts down from jumpBufferTime after pressing jump in air. */
  jumpBufferTimer: number;
  /** Set true when the player releases jump mid-rising (triggers jump-cut). */
  hasCutJump: boolean;
  /** Remembers whether the player was sprinting when they left the ground. */
  wasRunningBeforeAir: boolean;

  // ── Eye height ──
  /** Standing eye height (1.6 m). */
  eyeHeightStanding: number;
  /** Crouching eye height (0.9 m). */
  eyeHeightCrouching: number;

  // ── FOV ──
  baseFov: number;
  sprintFov: number;
}

// ── Factory ──────────────────────────────────────────────────────────────

const DEFAULT_PROFILE: InteriorMovementProfile = {
  walkSpeed: 3.0,
  sprintSpeed: 4.35,
  acceleration: 10.5,
  deceleration: 13.5,
  crouchSpeed: 1.5,
  sprintAccel: 8.0,
  sprintDecel: 10.0,
  airControl: 0.3,
  jumpVelocity: 5.2,
  jumpGravity: 18.0,
  fallGravity: 22.0,
  jumpCutMultiplier: 2.0,
  maxAirJumps: 0,
  coyoteTime: 0.15,
  jumpBufferTime: 0.18,
};

/** Mutable default snapshot used as the "previous frame" sentinel. */
function defaultSnapshot(): InputSnapshot {
  return {
    moveX: 0,
    moveZ: 0,
    jumpPressed: false,
    jumpHeld: false,
    sprintHeld: false,
    crouchHeld: false,
  };
}

/**
 * Build a fresh MovementContext wired to a specific room + camera + blueprint.
 * Called by Interior3D after the room is constructed.
 */
export function createMovementContext(
  camera: THREE.PerspectiveCamera,
  profile: InteriorMovementProfile,
  overrides: {
    collidesAt: MovementContext["collidesAt"];
    bounds: AABB;
    playerRadius: number;
    floorHeightAt: MovementContext["floorHeightAt"];
  },
): MovementContext {
  const p = { ...DEFAULT_PROFILE, ...profile };
  return {
    velocity: { x: 0, y: 0 },
    velocityY: 0,
    isOnGround: true,
    wasOnGround: true,
    collidesAt: overrides.collidesAt,
    bounds: overrides.bounds,
    playerRadius: overrides.playerRadius,
    floorHeightAt: overrides.floorHeightAt,
    input: defaultSnapshot(),
    camera,
    yaw: 0,
    walkSpeed: p.walkSpeed,
    sprintSpeed: p.sprintSpeed,
    crouchSpeed: p.crouchSpeed,
    accel: p.acceleration,
    decel: p.deceleration,
    airControl: p.airControl,
    jumpVelocity: p.jumpVelocity,
    jumpGravity: p.jumpGravity,
    fallGravity: p.fallGravity,
    jumpCutMultiplier: p.jumpCutMultiplier,
    maxAirJumps: p.maxAirJumps,
    coyoteTime: p.coyoteTime,
    jumpBufferTime: p.jumpBufferTime,
    airJumpsLeft: p.maxAirJumps,
    coyoteTimer: 0,
    jumpBufferTimer: 0,
    hasCutJump: false,
    wasRunningBeforeAir: false,
    eyeHeightStanding: 1.6,
    eyeHeightCrouching: 0.9,
    baseFov: 72,
    sprintFov: 76,
  };
}
