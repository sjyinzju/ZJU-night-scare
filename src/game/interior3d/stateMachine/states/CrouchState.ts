import type { IMovementState, StateTransition } from "../MovementState";
import type { MovementContext } from "../MovementContext";

/**
 * Crouch state — reduced movement speed, lowered eye height.
 *
 * Transitions out when the crouch key is released (and there is ceiling
 * clearance) or when the player jumps (crouch-jump to reach low gaps).
 *
 * Reference: godot-horror-playtest CROUCHING_SPEED 1.5
 */
export class CrouchState implements IMovementState {
  readonly name = "crouch";

  /** Current eye-height value (lerped toward target each frame). */
  private currentEyeHeight = 1.6;

  enter(ctx: MovementContext): void {
    ctx.airJumpsLeft = ctx.maxAirJumps;
    ctx.coyoteTimer = 0;
    ctx.hasCutJump = false;
    this.currentEyeHeight = ctx.eyeHeightStanding;
  }

  exit(_ctx: MovementContext): void {
    /* nothing */
  }

  update(dt: number, ctx: MovementContext): StateTransition | null {
    // Lerp eye height toward crouch target.
    const targetEye = ctx.eyeHeightCrouching;
    this.currentEyeHeight += (targetEye - this.currentEyeHeight) * Math.min(1, dt * 10);

    // ── Not on ground → inair ──
    if (!ctx.isOnGround) {
      return { nextState: "inair" };
    }

    // ── Jump pressed → jump (crouch-jump) ──
    if (ctx.input.jumpPressed) {
      return { nextState: "jump" };
    }

    // ── Crouch released → stand up ──
    if (!ctx.input.crouchHeld) {
      const hasInput = ctx.input.moveX !== 0 || ctx.input.moveZ !== 0;
      if (!hasInput) return { nextState: "idle" };
      if (ctx.input.sprintHeld && ctx.input.moveZ > 0.1) return { nextState: "run" };
      return { nextState: "walk" };
    }

    // ── No input → stay crouched but decelerate ──
    const hasInput = ctx.input.moveX !== 0 || ctx.input.moveZ !== 0;
    if (!hasInput) {
      ctx.velocity.x = this.moveToward(ctx.velocity.x, 0, ctx.decel * dt);
      ctx.velocity.y = this.moveToward(ctx.velocity.y, 0, ctx.decel * dt);
      return null;
    }

    // ── Crouch-walk movement ──
    const sin = Math.sin(ctx.yaw);
    const cos = Math.cos(ctx.yaw);
    const forwardX = -sin;
    const forwardZ = -cos;
    const rightX = cos;
    const rightZ = -sin;

    const speed = ctx.crouchSpeed;
    const targetX = (forwardX * ctx.input.moveZ + rightX * ctx.input.moveX) * speed;
    const targetY = (forwardZ * ctx.input.moveZ + rightZ * ctx.input.moveX) * speed;

    ctx.velocity.x = this.moveToward(ctx.velocity.x, targetX, ctx.accel * 0.6 * dt);
    ctx.velocity.y = this.moveToward(ctx.velocity.y, targetY, ctx.accel * 0.6 * dt);

    return null;
  }

  /** Exposed for Interior3D to read the lerped eye height. */
  get eyeHeight(): number {
    return this.currentEyeHeight;
  }

  private moveToward(current: number, target: number, maxDelta: number): number {
    if (Math.abs(target - current) <= maxDelta) return target;
    return current + Math.sign(target - current) * maxDelta;
  }
}
