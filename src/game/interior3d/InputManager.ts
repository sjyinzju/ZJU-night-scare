import type { InputSnapshot } from "./stateMachine/MovementContext";

/**
 * Centralised input manager for the interior first-person view.
 *
 * Tracks keyboard state and merges it with virtual (touch-joystick) input
 * injected by the React overlay.  Produces a normalised `InputSnapshot`
 * consumed by the movement state machine each frame.
 *
 * This replaces the ad-hoc `keys: Set<string>` + `keyboardMoveVector()`
 * approach previously baked into Interior3D.
 */
export class InputManager {
  private readonly held = new Set<string>();
  private readonly justPressedThisFrame = new Set<string>();

  /** Virtual movement intent from touch joystick / external source. */
  private virtualMoveX = 0;
  private virtualMoveZ = 0;

  // ── public API ──

  /** Bind to window keydown / keyup listeners. */
  handleKeyDown(e: KeyboardEvent): void {
    const code = e.code;
    if (!this.isTracked(code)) return;
    e.preventDefault();
    if (!this.held.has(code)) {
      this.justPressedThisFrame.add(code);
    }
    this.held.add(code);
  }

  handleKeyUp(e: KeyboardEvent): void {
    const code = e.code;
    if (!this.isTracked(code)) return;
    e.preventDefault();
    this.held.delete(code);
  }

  /**
   * Inject movement from the React virtual joystick (or any external source).
   * x = strafe (-1 left … 1 right), z = forward (-1 back … 1 forward).
   */
  setVirtualMove(x: number, z: number): void {
    this.virtualMoveX = x;
    this.virtualMoveZ = z;
  }

  /**
   * Build the frame's input snapshot and clear per-frame edge detectors.
   * Call exactly once per animation frame, before the state machine update.
   */
  pollInput(): InputSnapshot {
    const kbX = (this.held.has("KeyD") || this.held.has("ArrowRight") ? 1 : 0) -
                (this.held.has("KeyA") || this.held.has("ArrowLeft") ? 1 : 0);
    const kbZ = (this.held.has("KeyW") || this.held.has("ArrowUp") ? 1 : 0) -
                (this.held.has("KeyS") || this.held.has("ArrowDown") ? 1 : 0);

    // Merge keyboard + virtual; clamp to unit circle.
    let mx = kbX + this.virtualMoveX;
    let mz = kbZ + this.virtualMoveZ;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }

    const jumpPressed = this.justPressedThisFrame.has("Space");
    const jumpHeld = this.held.has("Space");
    const sprintHeld = this.held.has("ShiftLeft") || this.held.has("ShiftRight");
    const crouchHeld = this.held.has("ControlLeft") || this.held.has("ControlRight") || this.held.has("KeyC");

    // Clear edge detectors for the next frame.
    this.justPressedThisFrame.clear();

    return { moveX: mx, moveZ: mz, jumpPressed, jumpHeld, sprintHeld, crouchHeld };
  }

  /** Resets all held keys (useful when the tab loses focus). */
  reset(): void {
    this.held.clear();
    this.justPressedThisFrame.clear();
    this.virtualMoveX = 0;
    this.virtualMoveZ = 0;
  }

  // ── internals ──

  private isTracked(code: string): boolean {
    return (
      code === "KeyW" || code === "KeyA" || code === "KeyS" || code === "KeyD" ||
      code === "ArrowUp" || code === "ArrowDown" || code === "ArrowLeft" || code === "ArrowRight" ||
      code === "ShiftLeft" || code === "ShiftRight" ||
      code === "ControlLeft" || code === "ControlRight" ||
      code === "KeyC" ||
      code === "Space" ||
      code === "F3"
    );
  }
}
