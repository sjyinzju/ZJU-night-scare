import type { IMovementState, StateTransition } from "../MovementState";
import type { MovementContext } from "../MovementContext";

/**
 * Player is airborne (falling, or after jumping and now descending).
 *
 * This is the "default" air state — entered when the player walks off a
 * ledge (without jumping) or after the JumpState's upward phase ends.
 *
 * Features (inspired by Godot TPC InAirState):
 * - Separate fall gravity (heavier than jump gravity)
 * - Jump cut: if hasCutJump, apply increased gravity
 * - Coyote time: brief window after walking off ledge to still jump
 * - Jump buffering: press jump before landing → auto-jump on touchdown
 * - Landing detection + squash/stretch preparation
 * - Wall-hit velocity cut (optional)
 */
export class InAirState implements IMovementState {
  readonly name = "inair";

  enter(ctx: MovementContext): void {
    // Coyote time: if we just walked off a ledge (was on ground last frame)
    if (ctx.wasOnGround && ctx.coyoteTimer <= 0) {
      ctx.coyoteTimer = ctx.coyoteTime;
    }
  }

  exit(ctx: MovementContext): void {
    // Reset air state on landing.
    if (ctx.isOnGround) {
      ctx.velocityY = 0;
      ctx.airJumpsLeft = ctx.maxAirJumps;
      ctx.coyoteTimer = 0;
      ctx.hasCutJump = false;
    }
  }

  update(dt: number, ctx: MovementContext): StateTransition | null {
    // ── Tick timers ──
    if (ctx.coyoteTimer > 0) {
      ctx.coyoteTimer -= dt;
    }
    if (ctx.jumpBufferTimer > 0) {
      ctx.jumpBufferTimer -= dt;
    }

    // ── Apply gravity ──
    if (ctx.hasCutJump && ctx.velocityY > 0) {
      // Jump cut: player released jump → fall faster.
      ctx.velocityY -= ctx.jumpGravity * ctx.jumpCutMultiplier * dt;
    } else if (ctx.velocityY > 0) {
      ctx.velocityY -= ctx.jumpGravity * dt;
    } else {
      ctx.velocityY -= ctx.fallGravity * dt;
    }

    // ── Clamp fall speed (terminal velocity) ──
    if (ctx.velocityY < -30) {
      ctx.velocityY = -30;
    }

    // ── Landing detection ──
    if (ctx.isOnGround) {
      // Jump buffer: pressed jump while falling → auto-jump on landing.
      if (ctx.jumpBufferTimer > 0) {
        ctx.jumpBufferTimer = 0;
        return { nextState: "jump" };
      }
      return this.landingState(ctx);
    }

    // ── Coyote jump: pressed jump within coyote window ──
    if (ctx.input.jumpPressed && ctx.coyoteTimer > 0) {
      ctx.coyoteTimer = 0;
      return { nextState: "jump" };
    }

    // ── Normal jump press while in air ──
    if (ctx.input.jumpPressed) {
      // Multi-jump check
      if (ctx.airJumpsLeft > 0) {
        return { nextState: "jump" };
      }
      // Jump buffering: remember the press for when we land.
      if (ctx.jumpBufferTimer <= 0) {
        ctx.jumpBufferTimer = ctx.jumpBufferTime;
      }
    }

    // ── Air movement ──
    this.applyAirMovement(dt, ctx);

    return null;
  }

  private applyAirMovement(dt: number, ctx: MovementContext): void {
    if (ctx.input.moveX === 0 && ctx.input.moveZ === 0) {
      // No input — slowly decelerate horizontal velocity.
      ctx.velocity.x = this.moveToward(ctx.velocity.x, 0, ctx.decel * ctx.airControl * 0.5 * dt);
      ctx.velocity.y = this.moveToward(ctx.velocity.y, 0, ctx.decel * ctx.airControl * 0.5 * dt);
      return;
    }

    const sin = Math.sin(ctx.yaw);
    const cos = Math.cos(ctx.yaw);
    const forwardX = -sin;
    const forwardZ = -cos;
    const rightX = cos;
    const rightZ = -sin;

    // Air speed: reduced from walk speed.
    const airSpeed = ctx.walkSpeed * ctx.airControl;
    const airAccel = ctx.accel * ctx.airControl * 0.7;

    const targetX = (forwardX * ctx.input.moveZ + rightX * ctx.input.moveX) * airSpeed;
    const targetY = (forwardZ * ctx.input.moveZ + rightZ * ctx.input.moveX) * airSpeed;

    ctx.velocity.x = this.moveToward(ctx.velocity.x, targetX, airAccel * dt);
    ctx.velocity.y = this.moveToward(ctx.velocity.y, targetY, airAccel * dt);
  }

  private landingState(ctx: MovementContext): StateTransition {
    const hasInput = ctx.input.moveX !== 0 || ctx.input.moveZ !== 0;
    if (!hasInput) return { nextState: "idle" };
    if (ctx.input.sprintHeld && ctx.input.moveZ > 0.1) return { nextState: "run" };
    return { nextState: "walk" };
  }

  private moveToward(current: number, target: number, maxDelta: number): number {
    if (Math.abs(target - current) <= maxDelta) return target;
    return current + Math.sign(target - current) * maxDelta;
  }
}
