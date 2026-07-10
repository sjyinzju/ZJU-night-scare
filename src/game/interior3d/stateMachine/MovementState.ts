import type { MovementContext } from "./MovementContext";

/**
 * A transition request returned by a state's `update()` method.
 * The state machine reads this and performs enter/exit on the named states.
 */
export interface StateTransition {
  /** Name of the target state (case-insensitive match against registered states). */
  nextState: string;
}

/**
 * Contract every movement state must fulfil.
 *
 * Each state instance is a singleton-like object kept alive for the
 * lifetime of the game.  Mutable per-run data lives on `MovementContext`
 * so that the same state objects can be reused across runs without
 * stale carry-over.
 *
 * This pattern mirrors the Godot TPC state-machine design:
 *   State (base) → IdleState / WalkState / RunState / JumpState / InAirState
 */
export interface IMovementState {
  /** Unique lowercase name used for registration & transition look-up. */
  readonly name: string;

  /**
   * Called once when this state becomes active.
   * Reset timers, apply initial physics impulses, etc.
   */
  enter(ctx: MovementContext): void;

  /**
   * Called once when this state is about to be left.
   * Clean up transient effects started in `enter()`.
   */
  exit(ctx: MovementContext): void;

  /**
   * Called every frame.  The state reads input from `ctx.input`,
   * mutates `ctx.velocity` / timers / etc., and returns a
   * `StateTransition` when it wants to switch states.
   *
   * @returns A transition descriptor, or `null` to stay in this state.
   */
  update(dt: number, ctx: MovementContext): StateTransition | null;
}
