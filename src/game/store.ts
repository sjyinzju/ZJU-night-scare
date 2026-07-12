/**
 * Zustand 共享状态 — React 和 Phaser 的单一数据源。
 * Phaser 通过 getState()/setState() 读写，React 通过 hook 订阅。
 */
import { create } from "zustand";
import { getSceneHotspot, type HorrorEffect, type HotspotId, type ItemId, type StatKey, type StorySceneId } from "./storyData";
import type { IsoPoint } from "./mapData";

// ── 鬼状态机 ──
export type GhostFSM =
  | "hidden"
  | "patrol"       // 巡逻 — 沿预设路线缓慢移动，视线检测玩家
  | "stalking"
  | "ambush"
  | "chasing"
  | "retreating";

export interface GhostSnapshot {
  fsm: GhostFSM;
  iso: IsoPoint;
  visible: boolean;
  playerDistance: number;
  lastStateChangeAt: number;
}

// ── 氛围 ──
export type StoryStage = number;

/** The one authoritative lifecycle for the playable session. */
export type WorldState = "title" | "map" | "interior" | "ending" | "dead";
export type TransitionState = "idle" | "entering" | "leaving";
export type EnterableBuilding = { id: string; name: string; zone?: string };

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
  /**
   * Session state is deliberately separate from the story pointer.  A story
   * scene can be waiting for a world trigger while no modal is visible.
   */
  world: WorldState;
  transition: TransitionState;
  gameStarted: boolean;
  interiorBuilding: EnterableBuilding | null;
  nearBuilding: EnterableBuilding | null;
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
  startSession: (building: EnterableBuilding) => void;
  openInterior: (building: EnterableBuilding) => boolean;
  closeInterior: () => void;
  setNearBuilding: (building: EnterableBuilding | null) => void;
  setTransition: (transition: TransitionState) => void;
  setWorld: (world: WorldState) => void;
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
  stats: { sanity: 100, stamina: 100, clues: 0, trust: 50, affection: 0 },
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
  // 医学分馆门外：开场 3D 内景结束后回到这里，而不是默认的医学院入口。
  player: { x: 19.4, y: 30.2 },
  ghostVisible: false,
};

export const useGameStore = create<GameStore>((set) => ({
  world: "title",
  transition: "idle",
  gameStarted: false,
  interiorBuilding: null,
  nearBuilding: null,
  playerIso: { x: 19.4, y: 30.2 },
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

  startSession: (building) =>
    set({
      world: "interior",
      transition: "idle",
      gameStarted: true,
      interiorBuilding: building,
      nearBuilding: null,
      playerIso: { x: 19.4, y: 30.2 },
    }),

  /** Idempotent by design: duplicate proximity/E-key events cannot remount an interior. */
  openInterior: (building) => {
    const state = useGameStore.getState();
    if (state.world === "dead" || state.world === "ending" || state.transition !== "idle") return false;
    if (state.interiorBuilding?.id === building.id || state.world === "interior") return false;
    set({ world: "interior", transition: "idle", interiorBuilding: building, nearBuilding: null });
    return true;
  },

  closeInterior: () =>
    set({ world: "map", transition: "idle", interiorBuilding: null, nearBuilding: null }),

  setNearBuilding: (nearBuilding) => set({ nearBuilding }),
  setTransition: (transition) => set({ transition }),
  setWorld: (world) => set({ world }),

  setGhost: (partial) =>
    set((s) => ({ ghost: { ...s.ghost, ...partial } })),

  setGhostFSM: (fsm) =>
    set((s) => ({
      ghost: { ...s.ghost, fsm, lastStateChangeAt: Date.now() },
    })),

  setStoryState: (updater) =>
    set((s) => {
      const storyState = updater(s.storyState);
      return { storyState, guideHotspotId: getSceneHotspot(storyState.currentSceneId) };
    }),

  setActiveSceneId: (id) =>
    set((s) => ({
      activeSceneId: id,
      world: id && s.storyState.currentSceneId.startsWith("ending") ? "ending" : s.world,
    })),

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
      world: "title",
      transition: "idle",
      gameStarted: false,
      interiorBuilding: null,
      nearBuilding: null,
      playerIso: { x: 19.4, y: 30.2 },
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
