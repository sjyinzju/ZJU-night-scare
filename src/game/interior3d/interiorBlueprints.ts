import type { RoomKind } from "./buildRoom";

export type InteriorMovementState = "idle" | "walk" | "run" | "jump" | "inair" | "crouch";

export interface InteriorMovementProfile {
  // ── Horizontal speeds ──
  walkSpeed: number;
  sprintSpeed: number;
  crouchSpeed: number;
  // ── Acceleration (ground) ──
  acceleration: number;
  deceleration: number;
  // ── Sprint-specific (overrides acceleration when sprinting) ──
  sprintAccel?: number;
  sprintDecel?: number;
  // ── Air movement ──
  /** Multiplier on ground acceleration when airborne. 0.3 = 30%. */
  airControl: number;
  // ── Jump physics ──
  /** Initial upward velocity impulse in m/s. */
  jumpVelocity: number;
  /** Gravity while rising (velocityY > 0). */
  jumpGravity: number;
  /** Gravity while falling (velocityY <= 0). Heavier for "weighty" feel. */
  fallGravity: number;
  /** Multiplier on jumpGravity when the player releases jump early. */
  jumpCutMultiplier: number;
  /** Extra jumps allowed while airborne (0 = single jump only). */
  maxAirJumps: number;
  /** Seconds after walking off a ledge that jump is still allowed. */
  coyoteTime: number;
  /** Seconds before landing that a jump press is remembered. */
  jumpBufferTime: number;
}

export interface InteriorBlueprint {
  kind: RoomKind;
  label: string;
  spawnYaw: number;
  movement: InteriorMovementProfile;
}

const DEFAULT_MOVEMENT: InteriorMovementProfile = {
  walkSpeed: 3.0,
  sprintSpeed: 4.35,
  crouchSpeed: 1.5,
  acceleration: 10.5,
  deceleration: 13.5,
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

export const INTERIOR_BLUEPRINTS: Record<RoomKind, InteriorBlueprint> = {
  library: {
    kind: "library",
    label: "Basic Library",
    spawnYaw: -0.96,
    movement: {
      ...DEFAULT_MOVEMENT,
      walkSpeed: 2.85,
      sprintSpeed: 4.0,
      // Library has high ceilings (mezzanine) — full jump feels good.
      jumpVelocity: 5.0,
      jumpGravity: 16.0,
      fallGravity: 20.0,
    },
  },
  medical: {
    kind: "medical",
    label: "Medical Interior",
    spawnYaw: Math.PI,
    movement: {
      ...DEFAULT_MOVEMENT,
      walkSpeed: 2.75,
      sprintSpeed: 3.85,
      // Medical — heavy atmosphere, slightly weightier feel.
      jumpVelocity: 4.8,
      fallGravity: 24.0,
    },
  },
  dorm: {
    kind: "dorm",
    label: "Dorm Room",
    spawnYaw: Math.PI,
    movement: {
      ...DEFAULT_MOVEMENT,
      walkSpeed: 2.65,
      sprintSpeed: 3.7,
      // Dorm — low ceiling, reduced jump.
      jumpVelocity: 3.5,
      jumpGravity: 20.0,
      fallGravity: 26.0,
    },
  },
  hall: {
    kind: "hall",
    label: "Hall",
    spawnYaw: Math.PI,
    movement: DEFAULT_MOVEMENT,
  },
};

export function getInteriorBlueprint(kind: RoomKind): InteriorBlueprint {
  return INTERIOR_BLUEPRINTS[kind];
}
