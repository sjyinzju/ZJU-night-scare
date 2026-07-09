import { Howl, Howler } from "howler";
import type { HorrorEffect, StoryScene } from "../storyData";

type EndingKind = NonNullable<StoryScene["ending"]>;
type AudibleHorrorEffect = Exclude<HorrorEffect, "whisper">;
type OneShotKey = AudibleHorrorEffect | "choiceSelect" | "hover" | "item" | "ghostHit" | "death";

type SceneAudioState = {
  sanity: number;
  activeStory: boolean;
  ending?: EndingKind;
};

type AudioTrack = {
  howl: Howl;
};

const FADE_MS = 950;

const mainBgmTracks: AudioTrack[] = [
  {
    howl: new Howl({ src: ["/audio/bgm/score-1.mp3"], loop: false, volume: 0, preload: true }),
  },
  {
    howl: new Howl({ src: ["/audio/bgm/score-2.mp3"], loop: false, volume: 0, preload: true }),
  },
];

const oneShots: Record<OneShotKey, Howl> = {
  shake: new Howl({ src: ["/audio/sfx/shake.wav"], volume: 0.52, preload: true }),
  jumpscare: new Howl({ src: ["/audio/sfx/jumpscare.wav"], volume: 0.72, preload: true }),
  reveal: new Howl({ src: ["/audio/sfx/reveal.wav"], volume: 0.42, preload: true }),
  ending: new Howl({ src: ["/audio/sfx/ending.wav"], volume: 0.5, preload: true }),
  choiceSelect: new Howl({ src: ["/audio/sfx/choice-select.wav"], volume: 0.24, preload: true }),
  hover: new Howl({ src: ["/audio/sfx/hover.wav"], volume: 0.18, preload: true }),
  item: new Howl({ src: ["/audio/sfx/item.wav"], volume: 0.34, preload: true }),
  ghostHit: new Howl({ src: ["/audio/sfx/ghost-hit.wav"], volume: 0.58, preload: true }),
  death: new Howl({ src: ["/audio/sfx/death.wav"], volume: 0.72, preload: true }),
};

const pageTurnSprites = ["turn1", "turn2", "turn3", "turn4", "turn5", "turn6"] as const;
type PageTurnSprite = (typeof pageTurnSprites)[number];

const pageTurnSound = new Howl({
  src: ["/audio/sfx/story-open.mp3"],
  volume: 0.36,
  preload: true,
  sprite: {
    turn1: [0, 520],
    turn2: [1120, 520],
    turn3: [2350, 520],
    turn4: [3650, 520],
    turn5: [5050, 520],
    turn6: [6500, 520],
  } satisfies Record<PageTurnSprite, [number, number]>,
});

const effectCooldownMs: Partial<Record<OneShotKey, number>> = {
  shake: 500,
  jumpscare: 1150,
  reveal: 650,
  ending: 2000,
  choiceSelect: 120,
  hover: 90,
  ghostHit: 900,
  death: 3000,
};

let unlocked = false;
let lastMixKey = "";
let lastEnding: EndingKind | undefined;
let currentSceneState: SceneAudioState = { sanity: 100, activeStory: false };
let mainBgmIndex = 0;
let mainBgmTargetVolume = 0;
let mainBgmStopTimer: number | undefined;
let pageTurnIndex = 0;
let lastPageTurnAt = 0;
const lastPlayedAt = new Map<OneShotKey, number>();

mainBgmTracks.forEach((track, index) => {
  track.howl.on("end", () => {
    if (!unlocked || mainBgmTargetVolume <= 0) return;
    track.howl.volume(0);
    mainBgmIndex = (index + 1) % mainBgmTracks.length;
    fadeMainBgm(mainBgmTargetVolume, 1100);
  });
});

function getActiveMainBgm() {
  const activeIndex = mainBgmTracks.findIndex((track) => track.howl.playing());
  if (activeIndex >= 0) {
    mainBgmIndex = activeIndex;
    return mainBgmTracks[activeIndex];
  }
  return mainBgmTracks[mainBgmIndex];
}

function fadeMainBgm(targetVolume: number, duration = FADE_MS) {
  mainBgmTargetVolume = targetVolume;
  if (mainBgmStopTimer) {
    window.clearTimeout(mainBgmStopTimer);
    mainBgmStopTimer = undefined;
  }

  if (targetVolume > 0) {
    const active = getActiveMainBgm();
    if (!active.howl.playing()) active.howl.play();
    active.howl.fade(Number(active.howl.volume()), targetVolume, duration);
    mainBgmTracks.forEach((track) => {
      if (track !== active && track.howl.playing()) {
        track.howl.fade(Number(track.howl.volume()), 0, duration);
        window.setTimeout(() => {
          track.howl.pause();
          track.howl.volume(0);
        }, duration + 80);
      }
    });
    return;
  }

  mainBgmTracks.forEach((track) => {
    track.howl.fade(Number(track.howl.volume()), 0, duration);
  });
  mainBgmStopTimer = window.setTimeout(() => {
    mainBgmTracks.forEach((track) => {
      track.howl.pause();
      track.howl.volume(0);
    });
  }, duration + 80);
}

function applyMix(volume: number, duration = FADE_MS) {
  fadeMainBgm(volume, duration);
}

function getMix(state: SceneAudioState) {
  if (state.ending === "death") return 0;
  if (state.ending) return 0.18;

  const lowSanity = state.sanity <= 30;
  const storyDuck = state.activeStory ? 0.58 : 1;
  return (lowSanity ? 0.18 : 0.28) * storyDuck;
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

function playPageTurn() {
  const now = Date.now();
  if (now - lastPageTurnAt < 180) return;
  lastPageTurnAt = now;

  const sprite = pageTurnSprites[pageTurnIndex % pageTurnSprites.length];
  pageTurnIndex += 1;
  pageTurnSound.stop();
  pageTurnSound.play(sprite);
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
    if (!effect || !unlocked || effect === "whisper") return;
    playOneShot(effect as AudibleHorrorEffect);
  },

  playChoice() {
    if (!unlocked) return;
    playOneShot("choiceSelect");
    playPageTurn();
  },

  playHover() {
    if (!unlocked) return;
    playOneShot("hover");
  },

  playItem() {
    if (!unlocked) return;
    playOneShot("item");
  },

  playGhostHit() {
    if (!unlocked) return;
    playOneShot("ghostHit");
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
