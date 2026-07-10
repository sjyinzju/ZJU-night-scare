import type { IMovementState, StateTransition } from "./MovementState";
import type { MovementContext } from "./MovementContext";

/**
 * Lightweight finite-state machine for interior first-person movement.
 *
 * States are registered by name at initialisation time and the machine
 * starts in `initialState`.  Each frame `update()` is called, which
 * delegates to the current state and handles any requested transition.
 *
 * Usage:
 * ```ts
 * const fsm = new MovementStateMachine();
 * fsm.register(new IdleState());
 * fsm.register(new WalkState());
 * // … register all states …
 * fsm.start("idle", ctx);
 * // each frame:
 * fsm.update(dt, ctx);
 * ```
 */
export class MovementStateMachine {
  private readonly states = new Map<string, IMovementState>();
  private current: IMovementState | null = null;
  private _currentName = "";

  /** Name of the currently active state (empty string before start). */
  get currentName(): string {
    return this._currentName;
  }

  /** The currently active state instance, or null before start. */
  get currentState(): IMovementState | null {
    return this.current;
  }

  /**
   * Register a state instance.  The state's `name` (lowercased) is used
   * as the lookup key for transitions.
   */
  register(state: IMovementState): void {
    const key = state.name.toLowerCase();
    if (this.states.has(key)) {
      console.warn(`[MovementStateMachine] overwriting state "${key}"`);
    }
    this.states.set(key, state);
  }

  /**
   * Enter the named state immediately.  Must be called once before the
   * first `update()`.
   */
  start(initialName: string, ctx: MovementContext): void {
    const target = this.lookup(initialName);
    if (!target) {
      console.warn(
        `[MovementStateMachine] start("${initialName}"): state not found, falling back to first registered`,
      );
      const first = this.states.values().next().value as IMovementState | undefined;
      if (!first) throw new Error("MovementStateMachine: no states registered");
      this.switchTo(first, ctx);
      return;
    }
    this.switchTo(target, ctx);
  }

  /**
   * Tick the current state.  If it returns a transition, perform the
   * switch synchronously within the same frame.
   */
  update(dt: number, ctx: MovementContext): void {
    if (!this.current) return;
    const transition = this.current.update(dt, ctx);
    if (transition) {
      const target = this.lookup(transition.nextState);
      if (target && target !== this.current) {
        this.switchTo(target, ctx);
      }
    }
  }

  // ── internals ──

  private lookup(name: string): IMovementState | undefined {
    return this.states.get(name.toLowerCase());
  }

  private switchTo(target: IMovementState, ctx: MovementContext): void {
    if (this.current) {
      this.current.exit(ctx);
    }
    this.current = target;
    this._currentName = target.name;
    target.enter(ctx);
  }
}
