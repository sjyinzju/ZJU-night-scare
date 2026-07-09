/**
 * Zustand 共享状态 — React 和 Phaser 的单一数据源。
 * Phaser 通过 getState()/setState() 读写，React 通过 hook 订阅。
 */
import { create } from "zustand";
import type { HorrorEffect, HotspotId, ItemId, StatKey, StorySceneId } from "./storyData";
import type { IsoPoint } from "./mapData";

// ── 鬼状态机 ──
export type GhostFSM =
  | "hidden"       // 不可见，等待生成计时
  | "stalking"     // 追踪玩家，保持中等距离
  | "ambush"       // 在下一个热点附近潜伏等待
  | "chasing"      // 近距离全速追击
  | "retreating";  // 被照片/护身符驱退

export interface GhostSnapshot {
  fsm: GhostFSM;
  iso: IsoPoint;
  visible: boolean;
  playerDistance: number;
  lastStateChangeAt: number;
}

// ── 氛围 ──
export type StoryStage = number;

export interface AtmosphereState {
  timeLabel: string;
  statusLabel: string;
  storyStage: StoryStage;
  stageName: string;
  realityDistortion: number;
}

// ── 最小地图快照 ──
export interface MiniMapSnapshot {
  player: IsoPoint;
  ghost?: IsoPoint;
  ghostVisible: boolean;
}

// ── 完整 Store ──
export interface GameStore {
  // ── 玩家 ──
  playerIso: IsoPoint;

  // ── 故事状态 (从 React 写入, Phaser 读取) ──
  storyState: {
    currentSceneId: StorySceneId;
    stats: Record<StatKey, number>;
    inventory: ItemId[];
    flags: Record<string, boolean>;
    visitedHotspots: HotspotId[];
    completedHotspots: HotspotId[];
    log: string[];
  };
  activeSceneId: StorySceneId | null;
  guideHotspotId: HotspotId;

  // ── 鬼 ──
  ghost: GhostSnapshot;

  // ── UI ──
  screenEffect: HorrorEffect | "low-sanity" | "";
  nextObjectiveCue: { place: string; objective: string } | null;
  hudPlace: string;
  hudPrompt: string;
  hudActiveHotspotId: HotspotId | undefined;

  // ── 氛围 ──
  atmosphere: AtmosphereState;

  // ── 小地图 ──
  miniMap: MiniMapSnapshot;

  // ── 惊吓文字 ──
  jumpscareText: string;

  // ── Actions ──
  setPlayerIso: (iso: IsoPoint) => void;
  setGhost: (partial: Partial<GhostSnapshot>) => void;
  setGhostFSM: (fsm: GhostFSM) => void;
  setStoryState: (
    updater: (prev: GameStore["storyState"]) => GameStore["storyState"],
  ) => void;
  setActiveSceneId: (id: StorySceneId | null) => void;
  setGuideHotspotId: (id: HotspotId) => void;
  setScreenEffect: (effect: HorrorEffect | "low-sanity" | "") => void;
  setNextObjectiveCue: (cue: { place: string; objective: string } | null) => void;
  setHud: (place: string, prompt: string, activeHotspotId?: HotspotId) => void;
  setAtmosphere: (partial: Partial<AtmosphereState>) => void;
  setMiniMap: (snapshot: MiniMapSnapshot) => void;
  setJumpscareText: (text: string) => void;
  resetAll: () => void;
}

const initialStoryState: GameStore["storyState"] = {
  currentSceneId: "library_intro" as StorySceneId,
  stats: { sanity: 100, stamina: 100, clues: 0, trust: 50 },
  inventory: [],
  flags: {},
  visitedHotspots: [],
  completedHotspots: [],
  log: ["00:47，紫金港的路灯还亮着。先去基础图书馆确认闭馆记录。"],
};

const initialGhost: GhostSnapshot = {
  fsm: "hidden",
  iso: { x: 0, y: 0 },
  visible: false,
  playerDistance: 999,
  lastStateChangeAt: 0,
};

const initialAtmosphere: AtmosphereState = {
  timeLabel: "00:47",
  statusLabel: "校园静默",
  storyStage: 0,
  stageName: "序幕",
  realityDistortion: 0,
};

const initialMiniMap: MiniMapSnapshot = {
  player: { x: 16.2, y: 30.6 },
  ghostVisible: false,
};

export const useGameStore = create<GameStore>((set) => ({
  playerIso: { x: 16.2, y: 30.6 },
  storyState: { ...initialStoryState, stats: { ...initialStoryState.stats }, log: [...initialStoryState.log] },
  activeSceneId: null,
  guideHotspotId: "library" as HotspotId,
  ghost: { ...initialGhost },
  screenEffect: "",
  nextObjectiveCue: null,
  hudPlace: "",
  hudPrompt: "",
  hudActiveHotspotId: undefined,
  atmosphere: { ...initialAtmosphere },
  miniMap: { ...initialMiniMap },
  jumpscareText: "别回头",

  setPlayerIso: (iso) => set({ playerIso: iso }),

  setGhost: (partial) =>
    set((s) => ({ ghost: { ...s.ghost, ...partial } })),

  setGhostFSM: (fsm) =>
    set((s) => ({
      ghost: { ...s.ghost, fsm, lastStateChangeAt: Date.now() },
    })),

  setStoryState: (updater) =>
    set((s) => ({ storyState: updater(s.storyState) })),

  setActiveSceneId: (id) => set({ activeSceneId: id }),

  setGuideHotspotId: (id) => set({ guideHotspotId: id }),

  setScreenEffect: (effect) => set({ screenEffect: effect }),

  setNextObjectiveCue: (cue) => set({ nextObjectiveCue: cue }),

  setHud: (place, prompt, activeHotspotId) =>
    set({ hudPlace: place, hudPrompt: prompt, hudActiveHotspotId: activeHotspotId }),

  setAtmosphere: (partial) =>
    set((s) => ({ atmosphere: { ...s.atmosphere, ...partial } })),

  setMiniMap: (snapshot) => set({ miniMap: snapshot }),

  setJumpscareText: (text) => set({ jumpscareText: text }),

  resetAll: () =>
    set({
      playerIso: { x: 16.2, y: 30.6 },
      storyState: {
        ...initialStoryState,
        stats: { ...initialStoryState.stats },
        log: [...initialStoryState.log],
      },
      activeSceneId: null,
      guideHotspotId: "library" as HotspotId,
      ghost: { ...initialGhost },
      screenEffect: "",
      nextObjectiveCue: null,
      hudPlace: "",
      hudPrompt: "",
      hudActiveHotspotId: undefined,
      atmosphere: { ...initialAtmosphere },
      miniMap: { ...initialMiniMap },
      jumpscareText: "别回头",
    }),
}));

// ── 便捷 selector ──
export const getStore = () => useGameStore.getState();
export const setStore = useGameStore.setState;
