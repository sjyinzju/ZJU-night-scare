import * as THREE from "three";

/**
 * Procedural interior textures. Everything is generated on a 2D canvas and
 * wrapped in a THREE.CanvasTexture, so no image assets are needed and the whole
 * thing tree-shakes to nothing on the server: in a non-DOM environment (Node
 * unit/build checks) every generator returns `null` and callers fall back to a
 * flat colour. This is what gives the furniture / floors / walls their grain
 * and "material" feel instead of reading as flat plastic.
 */

const hasDOM = typeof document !== "undefined";
const cache = new Map<string, THREE.Texture | null>();

function makeCanvas(size: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (!hasDOM) return null;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  return { c, ctx };
}

function toTexture(c: HTMLCanvasElement, repeat: number): THREE.Texture {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function hex(n: number): string {
  return "#" + n.toString(16).padStart(6, "0");
}

// Deterministic pseudo-random so textures are stable across reloads.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/** Fine grayscale grain, used as a subtle overlay for micro-variation. */
function grain(ctx: CanvasRenderingContext2D, size: number, amount: number, seed: number): void {
  const img = ctx.getImageData(0, 0, size, size);
  const r = rng(seed);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * amount;
    img.data[i] = clamp255(img.data[i] + n);
    img.data[i + 1] = clamp255(img.data[i + 1] + n);
    img.data[i + 2] = clamp255(img.data[i + 2] + n);
  }
  ctx.putImageData(img, 0, 0);
}
const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

function cached(key: string, repeat: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.Texture | null {
  if (cache.has(key)) return cache.get(key)!;
  const made = makeCanvas(256);
  if (!made) {
    cache.set(key, null);
    return null;
  }
  draw(made.ctx, 256);
  const tex = toTexture(made.c, repeat);
  cache.set(key, tex);
  return tex;
}

/** Wood grain: base colour with darker vertical streaks + a couple of knots. */
export function woodTexture(base: number, repeat = 1): THREE.Texture | null {
  return cached(`wood-${base}-${repeat}`, repeat, (ctx, S) => {
    ctx.fillStyle = hex(base);
    ctx.fillRect(0, 0, S, S);
    const r = rng(base);
    for (let x = 0; x < S; x += 2) {
      const streak = 0.5 + Math.sin(x * 0.06 + Math.sin(x * 0.013) * 3) * 0.5;
      ctx.fillStyle = `rgba(0,0,0,${0.04 + streak * 0.06})`;
      ctx.fillRect(x, 0, 1.4, S);
    }
    for (let k = 0; k < 2; k++) {
      const kx = r() * S, ky = r() * S, kr = 4 + r() * 6;
      const g = ctx.createRadialGradient(kx, ky, 1, kx, ky, kr);
      g.addColorStop(0, "rgba(0,0,0,0.25)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(kx, ky, kr, 0, Math.PI * 2);
      ctx.fill();
    }
    grain(ctx, S, 14, base + 7);
  });
}

/** Vinyl / speckled institutional floor (dorm & corridors). */
export function floorTexture(base: number, repeat = 6): THREE.Texture | null {
  return cached(`floor-${base}-${repeat}`, repeat, (ctx, S) => {
    ctx.fillStyle = hex(base);
    ctx.fillRect(0, 0, S, S);
    const r = rng(base + 3);
    for (let i = 0; i < 900; i++) {
      const dark = r() > 0.5;
      ctx.fillStyle = dark ? "rgba(0,0,0,0.10)" : "rgba(255,255,255,0.05)";
      ctx.fillRect(r() * S, r() * S, 1 + r() * 1.5, 1 + r() * 1.5);
    }
    grain(ctx, S, 10, base + 1);
  });
}

/** Square floor tiles with grout lines (medical / library ground). */
export function tileTexture(base: number, repeat = 4): THREE.Texture | null {
  return cached(`tile-${base}-${repeat}`, repeat, (ctx, S) => {
    ctx.fillStyle = hex(base);
    ctx.fillRect(0, 0, S, S);
    const n = 4, cell = S / n;
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 2;
    for (let i = 0; i <= n; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cell, 0);
      ctx.lineTo(i * cell, S);
      ctx.moveTo(0, i * cell);
      ctx.lineTo(S, i * cell);
      ctx.stroke();
    }
    grain(ctx, S, 8, base + 5);
  });
}

/** Rough plaster / painted wall. */
export function wallTexture(base: number, repeat = 3): THREE.Texture | null {
  return cached(`wall-${base}-${repeat}`, repeat, (ctx, S) => {
    ctx.fillStyle = hex(base);
    ctx.fillRect(0, 0, S, S);
    const r = rng(base + 9);
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = `rgba(0,0,0,${0.02 + r() * 0.03})`;
      ctx.lineWidth = 0.5 + r();
      ctx.beginPath();
      const y = r() * S;
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(S * 0.3, y + (r() - 0.5) * 20, S * 0.6, y + (r() - 0.5) * 20, S, y);
      ctx.stroke();
    }
    grain(ctx, S, 12, base + 2);
  });
}

/** Woven fabric (bedding / curtains / seats). */
export function fabricTexture(base: number, repeat = 3): THREE.Texture | null {
  return cached(`fabric-${base}-${repeat}`, repeat, (ctx, S) => {
    ctx.fillStyle = hex(base);
    ctx.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 3) {
      ctx.fillStyle = `rgba(255,255,255,0.03)`;
      ctx.fillRect(0, y, S, 1);
      ctx.fillStyle = `rgba(0,0,0,0.05)`;
      ctx.fillRect(0, y + 1.5, S, 1);
    }
    for (let x = 0; x < S; x += 3) {
      ctx.fillStyle = `rgba(0,0,0,0.04)`;
      ctx.fillRect(x, 0, 1, S);
    }
    grain(ctx, S, 9, base + 4);
  });
}

/** Brushed metal (beds, cabinets, rails). */
export function metalTexture(base: number, repeat = 2): THREE.Texture | null {
  return cached(`metal-${base}-${repeat}`, repeat, (ctx, S) => {
    ctx.fillStyle = hex(base);
    ctx.fillRect(0, 0, S, S);
    const r = rng(base + 6);
    for (let y = 0; y < S; y++) {
      ctx.fillStyle = `rgba(255,255,255,${r() * 0.03})`;
      ctx.fillRect(0, y, S, 1);
    }
    grain(ctx, S, 6, base + 8);
  });
}
