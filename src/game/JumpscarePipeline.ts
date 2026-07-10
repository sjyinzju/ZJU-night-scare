import type { JumpscareContext } from "./jumpscareTexts";

/**
 * Descriptor for a single jumpscare event, dispatched from any source
 * (ghost proximity, story trigger, mirror reveal, pickup, etc.).
 *
 * Reference: Unity Jumpscare.cs (trigger → display → wait → destroy pattern).
 */
export interface JumpscareEvent {
  /** Where / why this jumpscare triggered.  Used for text selection. */
  context: JumpscareContext;
  /** 0-1 intensity — controls shake magnitude, overlay opacity, etc. */
  intensity: number;
  /** How long the overlay / text stays visible (ms).  Default ~800. */
  duration?: number;
  /** Sanity cost of this jumpscare.  Default scales with intensity. */
  sanityCost?: number;
  /** Optional custom message (overrides the pool lookup). */
  customMessage?: string;
}

/**
 * Centralised jumpscare manager.
 *
 * Features:
 * - Cooldown gating (no spam — minimum gap between scares)
 * - Intensity-driven scaling (shake, flash, overlay duration)
 * - Recent-event tracking for variety in text selection
 * - Integration with existing `App.tsx` effect system via
 *   `zju-horror-effect` and `zju-horror-jumpscare` custom events
 *
 * Usage:
 * ```ts
 * JumpscarePipeline.trigger({ context: "ghost_close", intensity: 0.5 });
 * ```
 */
export class JumpscarePipeline {
  private static lastTriggerAt = 0;
  private static readonly COOLDOWN_MS = 4000;        // 4 s minimum between jumpscares
  private static readonly MIN_COOLDOWN_MS = 1800;    // 1.8 s for low-intensity (< 0.35)
  private static recent: JumpscareContext[] = [];     // last 5 contexts for variety

  /**
   * Fire a jumpscare.  Silently ignored if within the cooldown window.
   *
   * Returns `true` if the scare was actually dispatched, `false` if
   * suppressed by cooldown.
   */
  static trigger(event: JumpscareEvent): boolean {
    const now = performance.now();
    const minGap = event.intensity < 0.35
      ? JumpscarePipeline.MIN_COOLDOWN_MS
      : JumpscarePipeline.COOLDOWN_MS;

    if (now - JumpscarePipeline.lastTriggerAt < minGap) {
      return false;  // suppressed by cooldown
    }
    JumpscarePipeline.lastTriggerAt = now;

    // Track recent contexts for variety (max 5).
    JumpscarePipeline.recent.push(event.context);
    if (JumpscarePipeline.recent.length > 5) JumpscarePipeline.recent.shift();

    const duration = event.duration ?? Math.round(600 + event.intensity * 500);
    const sanityCost = event.sanityCost ?? Math.round(event.intensity * 6);

    // Dispatch the jumpscare through the existing event bus.
    // `zju-horror-effect` drives screen shake / flash (already wired in CampusScene + App).
    window.dispatchEvent(new CustomEvent("zju-horror-effect", {
      detail: { effect: "jumpscare" },
    }));

    // `zju-horror-jumpscare` carries the full payload so App.tsx can
    // pick the right text + overlay + sanity hit.
    window.dispatchEvent(new CustomEvent("zju-horror-jumpscare", {
      detail: {
        context: event.context,
        intensity: event.intensity,
        duration,
        sanityCost,
        customMessage: event.customMessage,
        recent: [...JumpscarePipeline.recent],
      },
    }));

    // Sanity hit (separate dispatch so the ghost-hit handler can reuse it).
    if (sanityCost > 0) {
      window.dispatchEvent(new CustomEvent("zju-horror-sanity-hit", {
        detail: { amount: -sanityCost, source: "jumpscare", context: event.context },
      }));
    }

    return true;
  }

  /** Reset cooldown (useful on game restart). */
  static reset(): void {
    JumpscarePipeline.lastTriggerAt = 0;
    JumpscarePipeline.recent = [];
  }
}
