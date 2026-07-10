import type { IMovementState, StateTransition } from "../MovementState";
import type { MovementContext } from "../MovementContext";

/**
 * Active jump: applies the initial vertical impulse, processes gravity
 * while velocityY > 0 (rising), and transitions to InAir once the
 * player starts falling.
 *
 * Features (inspired by Godot TPC JumpState):
 * - Multi-jump (double/triple jump in air) via `maxAirJumps`
 * - Jump cut: releasing jump early → increased gravity → lower apex
 * - Air control curves: different speed/accel based on wasRunningBeforeAir
 */
export class JumpState implements IMovementState {
  readonly name = "jump";

  enter(ctx: MovementContext): void {
    // Apply the upward impulse.
    ctx.velocityY = ctx.jumpVelocity;

    // Consume an air jump if we were already airborne.
    if (!ctx.wasOnGround && ctx.airJumpsLeft > 0) {
      ctx.airJumpsLeft -= 1;
    }

    // Consume jump buffer & coyote.
    ctx.jumpBufferTimer = 0;
    ctx.coyoteTimer = 0;
    ctx.hasCutJump = false;

    // Remember whether we were sprinting before leaving the ground.
    if (ctx.wasOnGround) {
      // This is the first jump — wasRunningBeforeAir is set by
      // Walk/Run/Idle/Crouch state's exit, or we infer it now.
      // The previous state's enter should have set this.
    }
  }

  exit(_ctx: MovementContext): void {
    /* nothing */
  }

  update(dt: number, ctx: MovementContext): StateTransition | null {
    // ── Apply gravity (lighter on the way up) ──
    if (ctx.velocityY > 0) {
      ctx.velocityY -= ctx.jumpGravity * dt;
    } else {
      ctx.velocityY -= ctx.fallGravity * dt;
    }

    // ── Jump cut: player released jump while still rising ──
    if (!ctx.input.jumpHeld && ctx.velocityY > 0 && !ctx.hasCutJump) {
      ctx.hasCutJump = true;
      // Switch to InAir which will apply the cut-multiplied gravity.
      return { nextState: "inair" };
    }

    // ── Started falling → InAir ──
    if (ctx.velocityY <= 0) {
      return { nextState: "inair" };
    }

    // ── Landed mid-jump (e.g. low ceiling) ──
    if (ctx.isOnGround) {
      return this.landingState(ctx);
    }

    // ── Multi-jump: another press while airborne ──
    if (ctx.input.jumpPressed && ctx.airJumpsLeft > 0) {
      // Re-apply the vertical impulse for the extra jump.
      ctx.velocityY = ctx.jumpVelocity;
      ctx.airJumpsLeft -= 1;
      ctx.hasCutJump = false;
    }

    // ── Air movement ──
    this.applyAirMovement(dt, ctx);

    return null;
  }

  private applyAirMovement(dt: number, ctx: MovementContext): void {
    const sin = Math.sin(ctx.yaw);
    const cos = Math.cos(ctx.yaw);
    const forwardX = -sin;
    const forwardZ = -cos;
    const rightX = cos;
    const rightZ = -sin;

    // Air speed — use walk speed as the reference, scaled by airControl.
    const airSpeed = ctx.walkSpeed * ctx.airControl;
    // Acceleration is also scaled down in the air.
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
