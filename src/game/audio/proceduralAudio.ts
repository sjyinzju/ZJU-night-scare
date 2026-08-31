/**
 * 纯 Web Audio API 程序化音效引擎
 * 零外部文件依赖 — 所有声音由代码合成
 *
 * 提供: 心跳 / 脚步声 / 文字弹窗轻响 / 增强 jump scare / 鬼呼吸声
 */

// ── AudioContext 懒初始化 ──
let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
  }
  if (ctx.state === "suspended") {
    ctx.resume();
  }
  return ctx;
}

// ── 失真曲线 ──
function makeDistortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const samples = 44100;
  const curve = new Float32Array(samples) as Float32Array<ArrayBuffer>;
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

// ══════════════════════════════════════════════════
// 心跳 — 低沉、缓慢
// ══════════════════════════════════════════════════
let heartbeatTimer: number | null = null;
let heartbeatGain: GainNode | null = null;

export function updateHeartbeat(sanity: number) {
  const audioCtx = getCtx();

  // 理智 > 55 不触发心跳
  if (sanity > 55) {
    stopHeartbeat();
    return;
  }

  // 理智越低: bpm 50→110 (更慢, 更沉), 音量 0→0.35
  const t = (55 - sanity) / 55;
  const bpm = 50 + t * 60;
  const volume = t * 0.35;

  if (!heartbeatGain) {
    heartbeatGain = audioCtx.createGain();
    heartbeatGain.gain.value = 0;
    heartbeatGain.connect(audioCtx.destination);
  }

  heartbeatGain.gain.linearRampToValueAtTime(volume, audioCtx.currentTime + 0.35);

  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
  }

  const thump = () => {
    const now = audioCtx.currentTime;

    // 第一拍 "lub" — 次声波级低沉
    const osc1 = audioCtx.createOscillator();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(26, now);
    osc1.frequency.exponentialRampToValueAtTime(11, now + 0.3);
    const g1 = audioCtx.createGain();
    g1.gain.setValueAtTime(0.7, now);
    g1.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
    osc1.connect(g1).connect(heartbeatGain!);
    osc1.start(now);
    osc1.stop(now + 0.36);

    // sub-bass 层 — 半频加重沉闷感
    const oscSub = audioCtx.createOscillator();
    oscSub.type = "sine";
    oscSub.frequency.setValueAtTime(13, now);
    oscSub.frequency.exponentialRampToValueAtTime(6, now + 0.28);
    const gSub = audioCtx.createGain();
    gSub.gain.setValueAtTime(0.45, now);
    gSub.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
    oscSub.connect(gSub).connect(heartbeatGain!);
    oscSub.start(now);
    oscSub.stop(now + 0.34);

    // 第二拍 "dub" — 更长的延迟, 更轻
    const osc2 = audioCtx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(20, now + 0.36);
    osc2.frequency.exponentialRampToValueAtTime(9, now + 0.56);
    const g2 = audioCtx.createGain();
    g2.gain.setValueAtTime(0.001, now);
    g2.gain.setValueAtTime(0.22, now + 0.36);
    g2.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    osc2.connect(g2).connect(heartbeatGain!);
    osc2.start(now);
    osc2.stop(now + 0.62);
  };

  thump();
  heartbeatTimer = window.setInterval(thump, 60000 / bpm);
}

function stopHeartbeat() {
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (heartbeatGain) {
    heartbeatGain.gain.linearRampToValueAtTime(0, getCtx().currentTime + 0.4);
  }
}

// ══════════════════════════════════════════════════
// 文字弹窗轻响 — 深沉的柔软低频，替代弹簧音
// ══════════════════════════════════════════════════
let lastTextAppear = 0;

export function playTextAppear() {
  const audioCtx = getCtx();
  const now = audioCtx.currentTime;

  // 节流
  if (now * 1000 - lastTextAppear < 400) return;
  lastTextAppear = now * 1000;

  // 极低频 sine 脉冲 — 像远处关门或心跳漏拍
  const osc = audioCtx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(52, now);
  osc.frequency.exponentialRampToValueAtTime(28, now + 0.35);

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.08, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

  // 轻微混响感 — 短延时反馈
  const delay = audioCtx.createDelay(0.12);
  delay.delayTime.value = 0.08;
  const feedback = audioCtx.createGain();
  feedback.gain.value = 0.15;
  const dry = audioCtx.createGain();
  dry.gain.value = 0.85;

  osc.connect(dry).connect(audioCtx.destination);
  osc.connect(delay);
  delay.connect(feedback).connect(delay);
  delay.connect(gain).connect(audioCtx.destination);

  osc.start(now);
  osc.stop(now + 0.45);
}

// ══════════════════════════════════════════════════
// 脚步声 — 更慢、更沉稳
// ══════════════════════════════════════════════════
export type FootSurface = "concrete" | "gravel" | "wood" | "squish";

let lastFootstepTime = 0;
const FOOTSTEP_COOLDOWN = 620; // ms between steps (更沉稳的步频)

export function playFootstep(surface: FootSurface = "concrete") {
  const audioCtx = getCtx();
  const now = audioCtx.currentTime;

  if (now * 1000 - lastFootstepTime < FOOTSTEP_COOLDOWN) return;
  lastFootstepTime = now * 1000;

  const dur = surface === "squish" ? 0.14 : surface === "gravel" ? 0.12 : 0.1;
  const buf = audioCtx.createBuffer(
    1,
    Math.floor(audioCtx.sampleRate * dur),
    audioCtx.sampleRate,
  );
  const data = buf.getChannelData(0);
  // 更慢的衰减 → 更沉闷
  const decayRate = surface === "gravel" ? 0.032 : surface === "squish" ? 0.038 : 0.022;
  for (let i = 0; i < data.length; i++) {
    data[i] =
      (Math.random() * 2 - 1) * Math.exp(-i / (audioCtx.sampleRate * decayRate));
  }

  const source = audioCtx.createBufferSource();
  source.buffer = buf;

  // 更低的共振频率 → 更沉闷
  const bp = audioCtx.createBiquadFilter();
  bp.type = "bandpass";
  const freqMap: Record<FootSurface, number> = {
    concrete: 240,
    gravel: 420,
    wood: 140,
    squish: 90,
  };
  bp.frequency.value = freqMap[surface];
  bp.Q.value = surface === "gravel" ? 1.2 : surface === "squish" ? 0.35 : 0.7;

  const gain = audioCtx.createGain();
  const volMap: Record<FootSurface, number> = {
    concrete: 0.06,
    gravel: 0.07,
    wood: 0.05,
    squish: 0.04,
  };
  gain.gain.setValueAtTime(volMap[surface], now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

  source.connect(bp).connect(gain).connect(audioCtx.destination);
  source.start(now);
  source.stop(now + dur);
}

// ══════════════════════════════════════════════════
// 增强 Jump Scare (层叠合成器嘶吼)
// ══════════════════════════════════════════════════
export function playJumpscareScream(intensity: "mild" | "medium" | "extreme" = "extreme") {
  const audioCtx = getCtx();
  const now = audioCtx.currentTime;

  // Layer 1: 低频锯齿波扫频
  const osc1 = audioCtx.createOscillator();
  osc1.type = "sawtooth";
  osc1.frequency.setValueAtTime(180, now);
  osc1.frequency.exponentialRampToValueAtTime(28, now + 0.65);
  const g1 = audioCtx.createGain();
  const vol1 = { mild: 0.05, medium: 0.1, extreme: 0.16 }[intensity];
  g1.gain.setValueAtTime(vol1, now);
  g1.gain.exponentialRampToValueAtTime(0.001, now + 0.72);

  // Layer 2: 高频方波刺耳层
  const osc2 = audioCtx.createOscillator();
  osc2.type = "square";
  osc2.frequency.setValueAtTime(240, now);
  osc2.frequency.exponentialRampToValueAtTime(45, now + 0.5);
  const g2 = audioCtx.createGain();
  const vol2 = { mild: 0.02, medium: 0.05, extreme: 0.1 }[intensity];
  g2.gain.setValueAtTime(vol2, now);
  g2.gain.exponentialRampToValueAtTime(0.001, now + 0.55);

  // Layer 3: 噪声爆裂
  const noiseDur = 0.35;
  const noiseBuf = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * noiseDur), audioCtx.sampleRate);
  const noiseData = noiseBuf.getChannelData(0);
  for (let i = 0; i < noiseData.length; i++) {
    noiseData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (audioCtx.sampleRate * 0.06));
  }
  const noiseSrc = audioCtx.createBufferSource();
  noiseSrc.buffer = noiseBuf;
  const noiseFilter = audioCtx.createBiquadFilter();
  noiseFilter.type = "highpass";
  noiseFilter.frequency.value = 600;
  const noiseGain = audioCtx.createGain();
  noiseGain.gain.setValueAtTime(0.18, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + noiseDur);

  const distortion = audioCtx.createWaveShaper();
  distortion.curve = makeDistortionCurve(400);

  osc1.connect(distortion).connect(g1).connect(audioCtx.destination);
  osc2.connect(distortion).connect(g2).connect(audioCtx.destination);
  noiseSrc.connect(noiseFilter).connect(noiseGain).connect(audioCtx.destination);

  osc1.start(now);
  osc2.start(now);
  noiseSrc.start(now);
  osc1.stop(now + 0.78);
  osc2.stop(now + 0.6);
  noiseSrc.stop(now + noiseDur);
}

/** P4 坠落冲击：低频重击 + 短噪声 + 极短金属尾音，并通过压缩器限制峰值。 */
export function playImpactBang(): void {
  const audioCtx = getCtx();
  const now = audioCtx.currentTime;
  const compressor = audioCtx.createDynamicsCompressor();
  compressor.threshold.setValueAtTime(-14, now);
  compressor.knee.setValueAtTime(10, now);
  compressor.ratio.setValueAtTime(8, now);
  compressor.attack.setValueAtTime(0.002, now);
  compressor.release.setValueAtTime(0.18, now);
  compressor.connect(audioCtx.destination);

  const impact = audioCtx.createOscillator();
  impact.type = "sine";
  impact.frequency.setValueAtTime(82, now);
  impact.frequency.exponentialRampToValueAtTime(26, now + 0.38);
  const impactGain = audioCtx.createGain();
  impactGain.gain.setValueAtTime(0.46, now);
  impactGain.gain.exponentialRampToValueAtTime(0.001, now + 0.46);
  impact.connect(impactGain).connect(compressor);

  const noiseBuffer = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * 0.24), audioCtx.sampleRate);
  const noise = noiseBuffer.getChannelData(0);
  for (let index = 0; index < noise.length; index++) {
    noise[index] = (Math.random() * 2 - 1) * Math.exp(-index / (audioCtx.sampleRate * 0.035));
  }
  const noiseSource = audioCtx.createBufferSource();
  noiseSource.buffer = noiseBuffer;
  const lowpass = audioCtx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 760;
  const noiseGain = audioCtx.createGain();
  noiseGain.gain.setValueAtTime(0.28, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
  noiseSource.connect(lowpass).connect(noiseGain).connect(compressor);

  const metal = audioCtx.createOscillator();
  metal.type = "triangle";
  metal.frequency.setValueAtTime(1180, now + 0.035);
  metal.frequency.exponentialRampToValueAtTime(420, now + 0.25);
  const metalGain = audioCtx.createGain();
  metalGain.gain.setValueAtTime(0.001, now);
  metalGain.gain.setValueAtTime(0.07, now + 0.035);
  metalGain.gain.exponentialRampToValueAtTime(0.001, now + 0.27);
  metal.connect(metalGain).connect(compressor);

  impact.start(now);
  noiseSource.start(now);
  metal.start(now);
  impact.stop(now + 0.48);
  noiseSource.stop(now + 0.25);
  metal.stop(now + 0.28);
}

// ══════════════════════════════════════════════════
// 图书馆室外暴雨 — 持续风雨 + 稀疏雷声
// ══════════════════════════════════════════════════
let stormSources: AudioBufferSourceNode[] = [];
let stormMaster: GainNode | null = null;

function createLoopingNoiseBuffer(audioCtx: AudioContext, seconds: number, brown: boolean): AudioBuffer {
  const buffer = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * seconds), audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let index = 0; index < data.length; index++) {
    const white = Math.random() * 2 - 1;
    last = brown ? (last + 0.018 * white) / 1.018 : white;
    data[index] = brown ? last * 3.2 : white;
  }
  return buffer;
}

/** Start a restrained exterior-only wind/rain bed. Idempotent. */
export function startLibraryStorm(): void {
  if (stormMaster) return;
  const audioCtx = getCtx();
  const now = audioCtx.currentTime;
  stormMaster = audioCtx.createGain();
  stormMaster.gain.setValueAtTime(0.001, now);
  stormMaster.gain.linearRampToValueAtTime(0.18, now + 1.4);
  stormMaster.connect(audioCtx.destination);

  const rain = audioCtx.createBufferSource();
  rain.buffer = createLoopingNoiseBuffer(audioCtx, 3.7, false);
  rain.loop = true;
  const rainHigh = audioCtx.createBiquadFilter();
  rainHigh.type = "highpass";
  rainHigh.frequency.value = 950;
  const rainLow = audioCtx.createBiquadFilter();
  rainLow.type = "lowpass";
  rainLow.frequency.value = 5200;
  const rainGain = audioCtx.createGain();
  rainGain.gain.value = 0.28;
  rain.connect(rainHigh).connect(rainLow).connect(rainGain).connect(stormMaster);

  const wind = audioCtx.createBufferSource();
  wind.buffer = createLoopingNoiseBuffer(audioCtx, 4.9, true);
  wind.loop = true;
  const windBand = audioCtx.createBiquadFilter();
  windBand.type = "bandpass";
  windBand.frequency.value = 185;
  windBand.Q.value = 0.42;
  const windGain = audioCtx.createGain();
  windGain.gain.value = 0.52;
  wind.connect(windBand).connect(windGain).connect(stormMaster);

  rain.start(now);
  wind.start(now);
  stormSources = [rain, wind];
}

export function stopLibraryStorm(): void {
  if (!stormMaster) return;
  const audioCtx = getCtx();
  const master = stormMaster;
  const sources = stormSources;
  stormMaster = null;
  stormSources = [];
  master.gain.cancelScheduledValues(audioCtx.currentTime);
  master.gain.setValueAtTime(Math.max(0.001, master.gain.value), audioCtx.currentTime);
  master.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.55);
  window.setTimeout(() => {
    for (const source of sources) {
      try { source.stop(); } catch { /* source may already have ended */ }
    }
    master.disconnect();
  }, 620);
}

/** A delayed rolling thunder crack, paired with the full-screen lightning pulse. */
export function playLibraryThunder(delaySeconds = 0.22): void {
  const audioCtx = getCtx();
  const now = audioCtx.currentTime + Math.max(0, delaySeconds);
  const compressor = audioCtx.createDynamicsCompressor();
  compressor.threshold.value = -16;
  compressor.ratio.value = 7;
  compressor.connect(audioCtx.destination);

  const rumble = audioCtx.createBufferSource();
  rumble.buffer = createLoopingNoiseBuffer(audioCtx, 2.6, true);
  const lowpass = audioCtx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.setValueAtTime(520, now);
  lowpass.frequency.exponentialRampToValueAtTime(70, now + 2.4);
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.001, now);
  gain.gain.linearRampToValueAtTime(0.42, now + 0.035);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 2.5);
  rumble.connect(lowpass).connect(gain).connect(compressor);
  rumble.start(now);
  rumble.stop(now + 2.6);
}

/** White-flash thunder used by Baisha's authored photo and balcony beats. */
export function playBaishaThunder(): void {
  const audioCtx = getCtx();
  const now = audioCtx.currentTime;
  const compressor = audioCtx.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 8;
  compressor.ratio.value = 9;
  compressor.attack.value = 0.002;
  compressor.release.value = 0.32;
  compressor.connect(audioCtx.destination);

  const crackBuffer = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * 0.42), audioCtx.sampleRate);
  const crackData = crackBuffer.getChannelData(0);
  for (let index = 0; index < crackData.length; index++) {
    crackData[index] = (Math.random() * 2 - 1) * Math.exp(-index / (audioCtx.sampleRate * 0.035));
  }
  const crack = audioCtx.createBufferSource();
  crack.buffer = crackBuffer;
  const crackFilter = audioCtx.createBiquadFilter();
  crackFilter.type = "bandpass";
  crackFilter.frequency.value = 1350;
  crackFilter.Q.value = 0.5;
  const crackGain = audioCtx.createGain();
  crackGain.gain.setValueAtTime(0.68, now);
  crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
  crack.connect(crackFilter).connect(crackGain).connect(compressor);

  const rumble = audioCtx.createBufferSource();
  rumble.buffer = createLoopingNoiseBuffer(audioCtx, 3.1, true);
  const rumbleFilter = audioCtx.createBiquadFilter();
  rumbleFilter.type = "lowpass";
  rumbleFilter.frequency.setValueAtTime(620, now);
  rumbleFilter.frequency.exponentialRampToValueAtTime(58, now + 2.9);
  const rumbleGain = audioCtx.createGain();
  rumbleGain.gain.setValueAtTime(0.62, now);
  rumbleGain.gain.exponentialRampToValueAtTime(0.001, now + 3.0);
  rumble.connect(rumbleFilter).connect(rumbleGain).connect(compressor);

  crack.start(now);
  crack.stop(now + 0.44);
  rumble.start(now);
  rumble.stop(now + 3.1);
}

export const BAISHA_WINDOW_KNOCK_PROFILE = {
  offsets: [0, 0.62, 1.42] as const,
  strengths: [0.42, 0.68, 1] as const,
  resonancesHz: [1780, 2710, 4260, 6380] as const,
};

function scheduleGlassKnock(
  audioCtx: BaseAudioContext,
  destination: AudioNode,
  when: number,
  strength: number,
  hitIndex: number,
): void {
  const hitBus = audioCtx.createGain();
  hitBus.gain.setValueAtTime(0.9, when);
  hitBus.connect(destination);

  // A very short, high-passed impact supplies the sharp contact against glass.
  const noiseDuration = 0.065;
  const noiseBuffer = audioCtx.createBuffer(
    1,
    Math.ceil(audioCtx.sampleRate * noiseDuration),
    audioCtx.sampleRate,
  );
  const noiseData = noiseBuffer.getChannelData(0);
  for (let index = 0; index < noiseData.length; index++) {
    const envelope = Math.exp(-index / (audioCtx.sampleRate * 0.009));
    noiseData[index] = (Math.random() * 2 - 1) * envelope;
  }

  const impact = audioCtx.createBufferSource();
  impact.buffer = noiseBuffer;
  const highpass = audioCtx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.setValueAtTime(1450, when);
  highpass.Q.setValueAtTime(0.75, when);
  const impactFocus = audioCtx.createBiquadFilter();
  impactFocus.type = "peaking";
  impactFocus.frequency.setValueAtTime(3550, when);
  impactFocus.Q.setValueAtTime(1.1, when);
  impactFocus.gain.setValueAtTime(7, when);
  const impactGain = audioCtx.createGain();
  impactGain.gain.setValueAtTime(0.001, when);
  impactGain.gain.linearRampToValueAtTime(0.52 * strength, when + 0.002);
  impactGain.gain.exponentialRampToValueAtTime(0.001, when + noiseDuration);
  impact.connect(highpass).connect(impactFocus).connect(impactGain).connect(hitBus);
  impact.start(when);
  impact.stop(when + noiseDuration);

  // Several inharmonic high-frequency partials make the pane ring like glass,
  // while the final hit lasts slightly longer and therefore feels heavier.
  const pitchScale = [1.018, 1, 0.982][hitIndex] ?? 1;
  const resonanceLevels = [0.24, 0.18, 0.115, 0.065];
  BAISHA_WINDOW_KNOCK_PROFILE.resonancesHz.forEach((frequency, resonanceIndex) => {
    const ring = audioCtx.createOscillator();
    ring.type = "sine";
    ring.frequency.setValueAtTime(frequency * pitchScale, when);
    const ringGain = audioCtx.createGain();
    const decay = 0.25 - resonanceIndex * 0.025 + hitIndex * 0.035;
    ringGain.gain.setValueAtTime(0.001, when);
    ringGain.gain.linearRampToValueAtTime(
      resonanceLevels[resonanceIndex] * strength,
      when + 0.0025,
    );
    ringGain.gain.exponentialRampToValueAtTime(0.001, when + decay);
    ring.connect(ringGain).connect(hitBus);
    ring.start(when);
    ring.stop(when + decay + 0.015);
  });
}

/** Schedule the three knocks; exported so the exact production sound can be rendered in audio QA. */
export function scheduleBaishaWindowKnocks(
  audioCtx: BaseAudioContext,
  destination: AudioNode,
  start = audioCtx.currentTime,
): void {
  const compressor = audioCtx.createDynamicsCompressor();
  compressor.threshold.setValueAtTime(-18, start);
  compressor.knee.setValueAtTime(8, start);
  compressor.ratio.setValueAtTime(5, start);
  compressor.attack.setValueAtTime(0.002, start);
  compressor.release.setValueAtTime(0.16, start);
  compressor.connect(destination);

  BAISHA_WINDOW_KNOCK_PROFILE.offsets.forEach((offset, index) => {
    scheduleGlassKnock(
      audioCtx,
      compressor,
      start + offset,
      BAISHA_WINDOW_KNOCK_PROFILE.strengths[index],
      index,
    );
  });
}

/** Resume procedural audio from the player's photo-dismiss gesture, before the one-second delay. */
export function primeBaishaWindowKnocks(): void {
  const audioCtx = getCtx();
  if (audioCtx.state === "suspended") void audioCtx.resume();
}

/** Three crisp glass knocks, each distinctly louder than the previous hit. */
export function playBaishaWindowKnocks(): void {
  const audioCtx = getCtx();
  scheduleBaishaWindowKnocks(audioCtx, audioCtx.destination, audioCtx.currentTime + 0.015);
}

// ══════════════════════════════════════════════════
// 鬼接近呼吸/低吼
// ══════════════════════════════════════════════════
let breathOsc: OscillatorNode | null = null;
let breathFilter: BiquadFilterNode | null = null;
let breathGainNode: GainNode | null = null;

export function updateGhostBreath(distance: number) {
  const audioCtx = getCtx();

  if (!breathOsc) {
    breathOsc = audioCtx.createOscillator();
    breathOsc.type = "sawtooth";
    breathOsc.frequency.value = 10;

    breathFilter = audioCtx.createBiquadFilter();
    breathFilter.type = "lowpass";
    breathFilter.frequency.value = 140;
    breathFilter.Q.value = 2.5;

    breathGainNode = audioCtx.createGain();
    breathGainNode.gain.value = 0;

    breathOsc.connect(breathFilter).connect(breathGainNode).connect(audioCtx.destination);
    breathOsc.start();
  }

  const proximity = Math.max(0, 1 - distance / 5);
  const vol = proximity * 0.035;
  const freq = 80 + proximity * 220;

  breathGainNode!.gain.linearRampToValueAtTime(vol, audioCtx.currentTime + 0.15);
  breathFilter!.frequency.linearRampToValueAtTime(freq, audioCtx.currentTime + 0.15);
}

export function stopGhostBreath() {
  if (breathGainNode) {
    breathGainNode.gain.linearRampToValueAtTime(0, getCtx().currentTime + 0.4);
  }
}

// ══════════════════════════════════════════════════
// 全局控制
// ══════════════════════════════════════════════════
let unlocked = false;

export function unlockProcedural() {
  if (unlocked) return;
  unlocked = true;
  getCtx();
}

export function resetProcedural() {
  stopHeartbeat();
  stopGhostBreath();
  stopLibraryStorm();
  lastFootstepTime = 0;
  lastTextAppear = 0;
}

export function isProceduralUnlocked() {
  return unlocked;
}
