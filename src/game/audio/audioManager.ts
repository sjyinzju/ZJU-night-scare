import { Howl, Howler } from "howler";
import type { HorrorEffect, StoryScene } from "../storyData";

type EndingKind = NonNullable<StoryScene["ending"]>;
type LoopKey = "night" | "lowSanity" | "ending" | "wind" | "electric" | "lake";
type OneShotKey = HorrorEffect | "choice" | "item" | "death";

type SceneAudioState = {
  sanity: number;
  activeStory: boolean;
  ending?: EndingKind;
};

type LoopTrack = {
  howl: Howl;
  stopTimer?: number;
};

const FADE_MS = 950;

const loops: Record<LoopKey, LoopTrack> = {
  night: {
    howl: new Howl({ src: ["/audio/bgm/night-campus.wav"], loop: true, volume: 0, preload: true }),
  },
  lowSanity: {
    howl: new Howl({ src: ["/audio/bgm/low-sanity.wav"], loop: true, volume: 0, preload: true }),
  },
  ending: {
    howl: new Howl({ src: ["/audio/bgm/ending.wav"], loop: true, volume: 0, preload: true }),
  },
  wind: {
    howl: new Howl({ src: ["/audio/ambient/wind.wav"], loop: true, volume: 0, preload: true }),
  },
  electric: {
    howl: new Howl({ src: ["/audio/ambient/electric-hum.wav"], loop: true, volume: 0, preload: true }),
  },
  lake: {
    howl: new Howl({ src: ["/audio/ambient/lake.wav"], loop: true, volume: 0, preload: true }),
  },
};

const oneShots: Record<OneShotKey, Howl> = {
  whisper: new Howl({ src: ["/audio/sfx/whisper.wav"], volume: 0.34, preload: true }),
  shake: new Howl({ src: ["/audio/sfx/shake.wav"], volume: 0.52, preload: true }),
  jumpscare: new Howl({ src: ["/audio/sfx/jumpscare.wav"], volume: 0.72, preload: true }),
  reveal: new Howl({ src: ["/audio/sfx/reveal.wav"], volume: 0.42, preload: true }),
  ending: new Howl({ src: ["/audio/sfx/ending.wav"], volume: 0.5, preload: true }),
  choice: new Howl({ src: ["/audio/sfx/choice.wav"], volume: 0.24, preload: true }),
  item: new Howl({ src: ["/audio/sfx/item.wav"], volume: 0.34, preload: true }),
  death: new Howl({ src: ["/audio/sfx/death.wav"], volume: 0.72, preload: true }),
};

const effectCooldownMs: Partial<Record<OneShotKey, number>> = {
  whisper: 550,
  shake: 500,
  jumpscare: 1150,
  reveal: 650,
  ending: 2000,
  death: 3000,
};

let unlocked = false;
let lastMixKey = "";
let lastEnding: EndingKind | undefined;
let currentSceneState: SceneAudioState = { sanity: 100, activeStory: false };
const lastPlayedAt = new Map<OneShotKey, number>();

function startLoop(key: LoopKey) {
  const track = loops[key];
  if (track.stopTimer) {
    window.clearTimeout(track.stopTimer);
    track.stopTimer = undefined;
  }
  if (!track.howl.playing()) {
    track.howl.play();
  }
}

function fadeLoop(key: LoopKey, targetVolume: number, duration = FADE_MS) {
  const track = loops[key];
  const currentVolume = Number(track.howl.volume());

  if (targetVolume > 0) {
    startLoop(key);
    track.howl.fade(currentVolume, targetVolume, duration);
    return;
  }

  track.howl.fade(currentVolume, 0, duration);
  if (track.stopTimer) window.clearTimeout(track.stopTimer);
  track.stopTimer = window.setTimeout(() => {
    if (Number(track.howl.volume()) <= 0.01) {
      track.howl.pause();
      track.howl.volume(0);
    }
  }, duration + 80);
}

function applyMix(volumes: Record<LoopKey, number>, duration = FADE_MS) {
  (Object.keys(loops) as LoopKey[]).forEach((key) => fadeLoop(key, volumes[key], duration));
}

function getMix(state: SceneAudioState): Record<LoopKey, number> {
  if (state.ending === "death") {
    return { night: 0, lowSanity: 0, ending: 0, wind: 0.05, electric: 0, lake: 0 };
  }

  if (state.ending) {
    return { night: 0, lowSanity: 0, ending: 0.24, wind: 0.06, electric: 0, lake: 0.03 };
  }

  const lowSanity = state.sanity <= 30;
  const storyDuck = state.activeStory ? 0.58 : 1;

  return {
    night: (lowSanity ? 0.16 : 0.23) * storyDuck,
    lowSanity: lowSanity ? 0.22 * storyDuck : 0,
    ending: 0,
    wind: 0.14 * storyDuck,
    electric: (state.activeStory ? 0.07 : 0.035) + (lowSanity ? 0.035 : 0),
    lake: lowSanity ? 0.07 : 0.035,
  };
}

function mixKey(state: SceneAudioState) {
  return [state.ending ?? "play", state.activeStory ? "story" : "map", state.sanity <= 30 ? "low" : "normal"].join(":");
}

function playOneShot(key: OneShotKey) {
  const now = Date.now();
  const cooldown = effectCooldownMs[key] ?? 0;
  const last = lastPlayedAt.get(key) ?? 0;
  if (now - last < cooldown) return;

  lastPlayedAt.set(key, now);
  oneShots[key].stop();
  oneShots[key].play();
}

export const audioManager = {
  unlock() {
    if (unlocked) return;
    unlocked = true;
    Howler.volume(0.86);
    applyMix(getMix(currentSceneState), 1200);
  },

  setSceneState(state: SceneAudioState) {
    currentSceneState = state;
    if (!unlocked) return;

    const key = mixKey(state);
    if (key !== lastMixKey) {
      applyMix(getMix(state), state.ending ? 1400 : FADE_MS);
      lastMixKey = key;
    }

    if (state.ending && state.ending !== lastEnding) {
      playOneShot(state.ending === "death" ? "death" : "ending");
    }
    lastEnding = state.ending;
  },

  playEffect(effect?: HorrorEffect) {
    if (!effect || !unlocked) return;
    playOneShot(effect);
  },

  playChoice() {
    if (!unlocked) return;
    playOneShot("choice");
  },

  playItem() {
    if (!unlocked) return;
    playOneShot("item");
  },

  reset() {
    lastEnding = undefined;
    lastMixKey = "";
    currentSceneState = { sanity: 100, activeStory: false };
    if (!unlocked) return;
    applyMix(getMix(currentSceneState), 800);
  },

  setMasterVolume(value: number) {
    Howler.volume(Math.max(0, Math.min(1, value)));
  },
};
