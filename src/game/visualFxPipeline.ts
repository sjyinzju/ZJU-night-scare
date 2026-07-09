import Phaser from "phaser";

export const HORROR_POST_FX_KEY = "HorrorPostFxPipeline";

const FRAG_SHADER = `
precision mediump float;

uniform sampler2D uMainSampler;
uniform float time;
uniform float distortion;
varying vec2 outTexCoord;

void main() {
  vec2 uv = outTexCoord;
  float pulse = sin(time * 2.1 + uv.y * 16.0) * 0.004 * distortion;
  float tear = step(0.985, sin(uv.y * 95.0 + time * 8.0)) * 0.012 * distortion;
  vec2 warped = uv + vec2(pulse + tear, sin(time + uv.x * 18.0) * 0.002 * distortion);

  vec4 base = texture2D(uMainSampler, warped);
  float red = texture2D(uMainSampler, warped + vec2(0.004 * distortion, 0.0)).r;
  float blue = texture2D(uMainSampler, warped - vec2(0.004 * distortion, 0.0)).b;
  float vignette = smoothstep(0.82, 0.18, distance(uv, vec2(0.5)));
  float scan = sin(uv.y * 720.0 + time * 28.0) * 0.025 * distortion;

  gl_FragColor = vec4(red, base.g - scan, blue, base.a) * (0.72 + vignette * 0.34);
}
`;

export class HorrorPostFxPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  private startedAt = 0;
  private distortion = 0;

  constructor(game: Phaser.Game) {
    super({
      game,
      name: HORROR_POST_FX_KEY,
      fragShader: FRAG_SHADER,
    });
    this.startedAt = performance.now();
  }

  setDistortion(value: number) {
    this.distortion = Phaser.Math.Clamp(value, 0, 1);
  }

  onPreRender() {
    this.set1f("time", (performance.now() - this.startedAt) / 1000);
    this.set1f("distortion", this.distortion);
  }
}
