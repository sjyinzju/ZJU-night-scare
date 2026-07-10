import type { IMovementState, StateTransition } from "../MovementState";
import type { MovementContext } from "../MovementContext";

/**
 * Standard walking movement.  Smooth acceleration toward the input
 * direction at walk speed.
 */
export class WalkState implements IMovementState {
  readonly name = "walk";

  enter(ctx: MovementContext): void {
    ctx.airJumpsLeft = ctx.maxAirJumps;
    ctx.coyoteTimer = 0;
    ctx.hasCutJump = false;
  }

  exit(_ctx: MovementContext): void {
    /* nothing */
  }

  update(dt: number, ctx: MovementContext): StateTransition | null {
    // ── Ground checks ──
    if (!ctx.isOnGround) {
      return { nextState: "inair" };
    }

    // ── Jump buffering ──
    if (ctx.jumpBufferTimer > 0) {
      ctx.jumpBufferTimer = 0;
      return { nextState: "jump" };
    }

    // ── Jump pressed ──
    if (ctx.input.jumpPressed) {
      return { nextState: "jump" };
    }

    // ── Crouch ──
    if (ctx.input.crouchHeld) {
      return { nextState: "crouch" };
    }

    // ── Sprint ──
    if (ctx.input.sprintHeld && !ctx.input.crouchHeld) {
      return { nextState: "run" };
    }

    // ── No input → idle ──
    const hasInput = ctx.input.moveX !== 0 || ctx.input.moveZ !== 0;
    if (!hasInput) {
      return { nextState: "idle" };
    }

    // ── Accelerate ──
    this.applyMovement(dt, ctx, ctx.walkSpeed, ctx.accel);

    return null;
  }

  protected applyMovement(
    dt: number,
    ctx: MovementContext,
    speed: number,
    accel: number,
  ): void {
    const sin = Math.sin(ctx.yaw);
    const cos = Math.cos(ctx.yaw);
    // World-space forward/right from yaw.
    const forwardX = -sin;
    const forwardZ = -cos;
    const rightX = cos;
    const rightZ = -sin;

    const targetX = (forwardX * ctx.input.moveZ + rightX * ctx.input.moveX) * speed;
    const targetY = (forwardZ * ctx.input.moveZ + rightZ * ctx.input.moveX) * speed;

    ctx.velocity.x = this.moveToward(ctx.velocity.x, targetX, accel * dt);
    ctx.velocity.y = this.moveToward(ctx.velocity.y, targetY, accel * dt);
  }

  private moveToward(current: number, target: number, maxDelta: number): number {
    if (Math.abs(target - current) <= maxDelta) return target;
    return current + Math.sign(target - current) * maxDelta;
  }
}
