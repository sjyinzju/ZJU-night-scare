import type { IMovementState, StateTransition } from "../MovementState";
import type { MovementContext } from "../MovementContext";

/**
 * Sprinting — faster than walk, can be toggle or hold, only while
 * moving forward and on the ground.
 *
 * Inspired by godot-FirstPersonStarter Sprint.gd + Godot TPC RunState.
 */
export class RunState implements IMovementState {
  readonly name = "run";

  /** When true, tapping sprint once locks running until pressed again. */
  private toggleMode = false;
  private wasSprintHeld = false;

  enter(ctx: MovementContext): void {
    ctx.airJumpsLeft = ctx.maxAirJumps;
    ctx.coyoteTimer = 0;
    ctx.hasCutJump = false;
    ctx.wasRunningBeforeAir = true;
    this.wasSprintHeld = ctx.input.sprintHeld;
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

    // ── Crouch cancels sprint ──
    if (ctx.input.crouchHeld) {
      return { nextState: "crouch" };
    }

    // ── Sprint release ──
    if (this.toggleMode) {
      // Toggle: pressing sprint again switches to walk
      if (ctx.input.sprintHeld && !this.wasSprintHeld) {
        this.wasSprintHeld = ctx.input.sprintHeld;
        return { nextState: "walk" };
      }
    } else {
      // Hold: releasing sprint while still moving → walk
      if (!ctx.input.sprintHeld) {
        const hasInput = ctx.input.moveX !== 0 || ctx.input.moveZ !== 0;
        return hasInput ? { nextState: "walk" } : { nextState: "idle" };
      }
    }
    this.wasSprintHeld = ctx.input.sprintHeld;

    // ── No input → idle ──
    const hasInput = ctx.input.moveX !== 0 || ctx.input.moveZ !== 0;
    if (!hasInput) {
      return { nextState: "idle" };
    }

    // ── Sprint-forward-only: if no forward component, drop to walk ──
    if (ctx.input.moveZ < 0.1) {
      return { nextState: "walk" };
    }

    // ── Accelerate ──
    this.applyMovement(dt, ctx, ctx.sprintSpeed, ctx.accel);

    return null;
  }

  private applyMovement(
    dt: number,
    ctx: MovementContext,
    speed: number,
    accel: number,
  ): void {
    const sin = Math.sin(ctx.yaw);
    const cos = Math.cos(ctx.yaw);
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
