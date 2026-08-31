import type { JumpscareContext } from "./jumpscareTexts";
import type { JumpscareSpriteId } from "./jumpscareAssets";

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
  /** How long the overlay / text stays visible (ms).  Default ~1200. */
  duration?: number;
  /** Sanity cost of this jumpscare.  Default scales with intensity. */
  sanityCost?: number;
  /** Optional custom message (overrides the pool lookup). */
  customMessage?: string;
  /** Optional visual sprite selected by the same central state-machine event. */
  spriteId?: JumpscareSpriteId;
}

/**
 * Centralised jumpscare manager.
 *
 * Features:
 * - Cooldown gating (no spam — minimum gap between scares)
 * - Intensity-driven scaling (shake, flash, overlay duration)
 * - Recent-event tracking for variety in text selection
 * - Integration with the `App.tsx` effect system via one
 *   `zju-horror-jumpscare` event. App starts visuals and audio together after
 *   any authored sprite has decoded.
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
   * Execute a story-driven effect (no cooldown — story beats must always fire).
   * Used by App.tsx when `advanceStory` returns an `effect`.
   */
  static executeStoryEffect(
    context: JumpscareContext,
    intensity = 0.5,
    customMessage?: string,
    spriteId?: JumpscareEvent["spriteId"],
    sanityCostOverride?: number,
  ): void {
    JumpscarePipeline.recent.push(context);
    if (JumpscarePipeline.recent.length > 5) JumpscarePipeline.recent.shift();

    const sanityCost = sanityCostOverride ?? Math.round(intensity * 6);

    window.dispatchEvent(new CustomEvent("zju-horror-jumpscare", {
      detail: {
        context,
        intensity,
        duration: 900 + Math.round(intensity * 500),
        sanityCost,
        customMessage,
        spriteId,
        recent: [...JumpscarePipeline.recent],
        storyDriven: true,
      },
    }));

    if (sanityCost > 0) {
      window.dispatchEvent(new CustomEvent("zju-horror-sanity-hit", {
        detail: { amount: -sanityCost, source: "jumpscare", context },
      }));
    }
  }

  /**
   * Fire a jumpscare.  Silently ignored if within the cooldown window.
   * Use this for ambient/ghost-driven scares. For story beats, use executeStoryEffect.
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

    const duration = event.duration ?? Math.round(900 + event.intensity * 500);
    const sanityCost = event.sanityCost ?? Math.round(event.intensity * 6);

    // One event carries the complete beat. App.tsx dispatches the camera
    // effect only when its text, sprite and audio can start together.
    window.dispatchEvent(new CustomEvent("zju-horror-jumpscare", {
      detail: {
        context: event.context,
        intensity: event.intensity,
        duration,
        sanityCost,
        customMessage: event.customMessage,
        spriteId: event.spriteId,
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
