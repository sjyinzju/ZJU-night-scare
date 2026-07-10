import type { IMovementState, StateTransition } from "../MovementState";
import type { MovementContext } from "../MovementContext";

/**
 * Player is standing still.  Decelerates any residual velocity to zero
 * and waits for input to transition to Walk, Run, Jump, InAir, or Crouch.
 */
export class IdleState implements IMovementState {
  readonly name = "idle";

  enter(ctx: MovementContext): void {
    // Reset per-trip counters when we land or come to rest.
    ctx.airJumpsLeft = ctx.maxAirJumps;
    ctx.coyoteTimer = 0;
    ctx.hasCutJump = false;
    ctx.wasRunningBeforeAir = false;
  }

  exit(_ctx: MovementContext): void {
    /* nothing to clean up */
  }

  update(dt: number, ctx: MovementContext): StateTransition | null {
    // ── Ground checks ──
    if (!ctx.isOnGround) {
      // Fell off a ledge (rare in Idle but possible if floor disappeared)
      if (ctx.coyoteTimer <= 0) {
        ctx.coyoteTimer = ctx.coyoteTime;
      }
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

    // ── Movement input ──
    const hasInput = ctx.input.moveX !== 0 || ctx.input.moveZ !== 0;
    if (hasInput) {
      if (ctx.input.sprintHeld) {
        return { nextState: "run" };
      }
      return { nextState: "walk" };
    }

    // ── Decelerate to rest ──
    ctx.velocity.x = this.moveToward(ctx.velocity.x, 0, ctx.decel * dt);
    ctx.velocity.y = this.moveToward(ctx.velocity.y, 0, ctx.decel * dt);

    return null;
  }

  private moveToward(current: number, target: number, maxDelta: number): number {
    if (Math.abs(target - current) <= maxDelta) return target;
    return current + Math.sign(target - current) * maxDelta;
  }
}
