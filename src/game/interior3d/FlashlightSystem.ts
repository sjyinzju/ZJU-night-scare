import * as THREE from "three";

/**
 * Manages flashlight battery, light intensity / angle, and visibility.
 *
 * Battery decays over time while the flashlight is on.  At low battery
 * levels the light dims, the spot angle narrows, and flicker intensifies.
 *
 * Battery pickups (collected in rooms) call `restore()` to refill.
 *
 * Reference: Unity FlashlightDecay.cs (spotAngle + intensity decay over time)
 */
export class FlashlightSystem {
  /** Battery level 0…1.  1 = full, 0 = dead. */
  battery = 1.0;

  /** Decay per second while the light is on.  Full battery lasts ~180 s. */
  private readonly decayRate = 1.0 / 180;

  // Saved reference values (full-charge state).
  private readonly maxIntensity: number;
  private readonly maxAngle: number;
  private readonly maxRange: number;

  /** Whether the flashlight is currently switched on. */
  private isOn = true;

  constructor(private readonly light: THREE.SpotLight) {
    this.maxIntensity = light.intensity;
    this.maxAngle = light.angle;
    this.maxRange = light.distance;
  }

  // ── Public API ──

  toggle(): void {
    this.isOn = !this.isOn;
  }

  /** Restore `amount` battery (0…1).  Called when picking up a battery item. */
  restore(amount: number): void {
    this.battery = Math.min(1, this.battery + amount);
  }

  /**
   * Call every frame.  Decays the battery and updates the light's visual
   * properties accordingly.
   *
   * @param dt   Delta time in seconds.
   * @param t    Elapsed time (for flicker sine).
   */
  update(dt: number, t: number): void {
    if (!this.isOn || this.battery <= 0) {
      this.light.intensity = 0;
      return;
    }

    // Decay.
    this.battery = Math.max(0, this.battery - this.decayRate * dt);

    const b = this.battery;

    // Intensity: full at high battery, drops sharply below 30 %.
    const intensityMul = b > 0.3 ? 0.7 + 0.3 * b : 0.3 * (b / 0.3);
    const baseIntensity = this.maxIntensity * intensityMul;

    // Spot angle: narrows as battery drains (min ~40 % of original).
    const angleMul = 0.4 + 0.6 * b;
    this.light.angle = this.maxAngle * angleMul;

    // Range shortens at low battery.
    this.light.distance = this.maxRange * (0.5 + 0.5 * b);

    // Flicker: subtle at full, aggressive at low battery.
    const flickerAmp = 0.04 + (1 - b) * 0.22;
    const flickerFreq = 22 + (1 - b) * 55;
    const flicker = Math.sin(t * flickerFreq) * flickerAmp + Math.sin(t * 7) * flickerAmp * 0.5;

    // Occasional "blink" when battery is very low (< 15 %).
    const blink = b < 0.15 && Math.sin(t * 3.7) > 0.92 ? 0 : 1;

    this.light.intensity = Math.max(0, baseIntensity + flicker * this.maxIntensity) * blink;

    // If battery fully dead, stay off until restored.
    if (this.battery <= 0) {
      this.light.intensity = 0;
    }
  }

  /** True when the battery is critically low (< 10 %). */
  get isCritical(): boolean {
    return this.battery <= 0.1;
  }

  /** True when the battery is completely dead. */
  get isDead(): boolean {
    return this.battery <= 0;
  }
}
