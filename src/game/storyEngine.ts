import {
  clampStat,
  getHotspotById,
  initialStoryState,
  itemCatalog,
  storyHotspots,
  storyScenes,
  type HorrorEffect,
  type HotspotId,
  type ItemId,
  type StatKey,
  type StoryChoice,
  type StoryScene,
  type StorySceneId,
  type StoryState,
} from "./storyData";
import { hotspotBuildingMap, type StoryStage, stageProfiles } from "./horrorConfig";
import { campusBuildings } from "./mapData";

export type StoryBuildingRef = { id: string; name: string; zone?: string };

export type StoryHotspotInteraction =
  | { kind: "none" }
  | { kind: "open-story"; hotspotId: HotspotId; sceneId: StorySceneId }
  | { kind: "enter-building"; hotspotId: HotspotId; sceneId: StorySceneId; building: StoryBuildingRef; storyMode: boolean };

export type StoryPostChoiceCommand =
  | { kind: "set-active-scene"; sceneId: StorySceneId | null }
  | { kind: "exit-interior" }
  | { kind: "enter-building"; hotspotId: HotspotId }
  | { kind: "show-objective"; place: string; objective: string };

export type StoryItemCollectionResult = {
  nextState: StoryState;
  collected: boolean;
  itemId?: ItemId;
};

export type InteriorStoryItemDefinition = {
  itemId: ItemId;
  placement: string;
  activeSceneIds?: StorySceneId[];
  color?: number;
};

export type InteriorStoryTriggerDefinition = {
  sceneId: string;
  position: string;
  action: "story" | "exit";
  activeSceneIds: StorySceneId[];
  radius?: number;
};

const INTERIOR_STORY_ITEMS: Record<string, InteriorStoryItemDefinition[]> = {
  library: [
    { itemId: "flashlight", placement: "flashlight", activeSceneIds: ["library_intro", "library_sound"], color: 0xfff1a8 },
  ],
  medical: [
    { itemId: "key_card", placement: "item-0", color: 0xffe08a },
    { itemId: "medicine", placement: "item-1", color: 0x8fd0ff },
  ],
  dorm: [
    { itemId: "photograph", placement: "item-0", color: 0xffe08a },
    { itemId: "energy", placement: "item-1", color: 0x8fd0ff },
  ],
  hall: [{ itemId: "talisman", placement: "item-0", color: 0xffe08a }],
};

const INTERIOR_STORY_TRIGGERS: Record<string, InteriorStoryTriggerDefinition[]> = {
  library: [
    { sceneId: "library_intro", position: "intro", action: "story", activeSceneIds: ["library_intro"], radius: 0.85 },
    { sceneId: "library_sound", position: "sound", action: "story", activeSceneIds: ["library_sound"] },
    { sceneId: "library_exit", position: "exit", action: "exit", activeSceneIds: ["library_police"] },
  ],
  dorm: [{ sceneId: "dorm_forum", position: "forum", action: "story", activeSceneIds: ["dorm_forum"] }],
  hall: [{ sceneId: "final_plan", position: "stage", action: "story", activeSceneIds: ["final_plan"] }],
  medical: [
    { sceneId: "ghost_choice", position: "ghost", action: "story", activeSceneIds: ["ghost_choice"] },
    { sceneId: "stand_ground", position: "stand", action: "story", activeSceneIds: ["stand_ground"] },
  ],
};

/** 3D 内景中 NPC 显现的场景 ID 集合——只有当前 sceneId 在其中时 NPC 才可见。 */
const INTERIOR_NPC_REVEAL_SCENE_IDS: Record<string, StorySceneId[]> = {
  library: ["library_sound"],
  dorm: ["dorm_forum"],
  medical: ["ghost_choice", "stand_ground"],
  hall: ["final_plan", "final_confrontation", "baiqiu_confession"],
};

export function getInteriorNpcRevealSceneIds(roomKind: string): StorySceneId[] {
  return INTERIOR_NPC_REVEAL_SCENE_IDS[roomKind] ?? [];
}

const INTERIOR_EXIT_TRIGGER_AFTER: Partial<Record<StorySceneId, StorySceneId[]>> = {
  library_sound: ["library_police"],
};

// ── StoryStage ↔ StorySceneId 联动 ──

/** 章节→StoryStage 映射表。从 storyScenes 的 chapter 字段推导。 */
const CHAPTER_STAGE_MAP: Record<string, StoryStage> = {
  "第一章": 1,
  "第二章": 2,
  "第三章": 3,
  "第四章": 4,
  "第五章": 5,
  "第六章": 5,
  "终章": 5,
  "结局": 5,
  "失败": 5,
};

/** 根据当前场景 ID 推导剧情阶段（1-5），驱动鬼AI、氛围、视觉特效。 */
export function storyStageFromSceneId(sceneId: StorySceneId): StoryStage {
  const scene = storyScenes[sceneId];
  if (!scene) return 1;
  return CHAPTER_STAGE_MAP[scene.chapter] ?? 1;
}

/** 便捷方法：从 StoryState 直接取当前 StoryStage。 */
export function getStoryStageForState(state: StoryState): StoryStage {
  return storyStageFromSceneId(state.currentSceneId);
}

// ── 热点/建筑准入（严格按剧情顺序）──

/**
 * 判断某个热点是否在当前剧情进度下可访问。
 * 规则：玩家只能访问 order ≤ 当前引导热点 order 的热点。
 * 这确保后面的建筑不会在前面就开放。
 */
export function isHotspotAccessible(hotspotId: HotspotId, guideHotspotId: HotspotId): boolean {
  const target = storyHotspots.find((h) => h.id === hotspotId);
  const guide = storyHotspots.find((h) => h.id === guideHotspotId);
  if (!target || !guide) return false;
  return target.order <= guide.order;
}

/**
 * 解析游戏开始时应该进入的建筑。
 * 始终从第一个热点（library / 医学分馆）开始。
 */
export function resolveGameStartBuilding(): StoryBuildingRef | null {
  const firstHotspot = storyHotspots.find((h) => h.order === 1);
  if (!firstHotspot) return null;
  return getStoryBuildingForHotspot(firstHotspot.id);
}

// ── 鬼命中统一管道 ──

/** 鬼命中/惊吓对理智的伤害结果。 */
export type GhostDamageResult = {
  nextState: StoryState;
  /** 是否触发死亡 */
  dead: boolean;
  /** 护身符是否格挡了本次伤害 */
  talismanBlocked: boolean;
};

/**
 * 统一处理鬼造成的理智伤害。
 * 复用 applyStatChanges 确保护身符格挡、日志记录等逻辑一致。
 */
export function applyGhostDamage(state: StoryState, amount: number): GhostDamageResult {
  const applied = applyStatChanges(state, { sanity: amount });
  const dead = applied.stats.sanity <= 0;
  return {
    nextState: {
      ...state,
      currentSceneId: dead ? "death_sanity" : state.currentSceneId,
      stats: dead ? { ...applied.stats, sanity: 0 } : applied.stats,
      inventory: applied.inventory,
      log: dead
        ? appendStoryLog(state.log, "红色鬼影贴到背后，你被拖进了地图外侧的黑暗。")
        : appendStoryLog(state.log, applied.blockedByTalisman
          ? "护身符发热，替你挡下了一次鬼影的精神侵蚀。"
          : "红色鬼影靠得太近，理智被撕下一截。"),
    },
    dead,
    talismanBlocked: applied.blockedByTalisman,
  };
}

export type StoryTransition = {
  nextState: StoryState;
  nextScene: StoryScene;
  nextHotspot: ReturnType<typeof getHotspotById>;
  changesLocation: boolean;
  effect?: HorrorEffect;
};

export type InventoryUseResult = {
  nextState: StoryState;
  used: boolean;
  effect?: HorrorEffect;
};

export type StoryGraphIssue = {
  severity: "error" | "warning";
  message: string;
};

export function createStoryState(): StoryState {
  return {
    ...initialStoryState,
    stats: { ...initialStoryState.stats },
    inventory: [...initialStoryState.inventory],
    flags: { ...initialStoryState.flags },
    visitedHotspots: [...initialStoryState.visitedHotspots],
    completedHotspots: [...initialStoryState.completedHotspots],
    log: [...initialStoryState.log],
  };
}

export function uniqueStoryValues<T extends string>(items: T[]) {
  return Array.from(new Set(items));
}

export function appendStoryLog(log: string[], line: string) {
  return [line, ...log].slice(0, 6);
}

export function isStoryItemId(itemId: string): itemId is ItemId {
  return itemId in itemCatalog;
}

export function getStoryBuildingForHotspot(hotspotId: HotspotId): StoryBuildingRef | null {
  const targetIds = hotspotBuildingMap[hotspotId] ?? [];
  const building = campusBuildings.find((b) => targetIds.includes(b.id) && b.enterable);
  if (!building) return null;
  return { id: building.id, name: building.name, zone: building.zone };
}

export function resolveStoryHotspotInteraction(hotspotId: HotspotId): StoryHotspotInteraction {
  const hotspot = getHotspotById(hotspotId);
  if (!hotspot) return { kind: "none" };

  if (hotspot.mode === "indoor-3d") {
    const building = getStoryBuildingForHotspot(hotspot.id);
    if (building) {
      return { kind: "enter-building", hotspotId: hotspot.id, sceneId: hotspot.sceneId, building, storyMode: true };
    }
  }

  return { kind: "open-story", hotspotId: hotspot.id, sceneId: hotspot.sceneId };
}

/** 从 HotspotId 反推对应的 RoomKind（用于判断 indoor→indoor 是否同房间）。 */
function inferRoomKindForLocation(locationId: HotspotId): string {
  const buildingIds = hotspotBuildingMap[locationId] ?? [];
  if (!buildingIds.length) return "";
  const building = campusBuildings.find((b) => buildingIds.includes(b.id) && b.enterable);
  if (!building) return "";
  const key = `${building.id} ${building.zone ?? ""}`.toLowerCase();
  if (/medical-library/.test(key)) return "library";
  if (/dorm|hostel|宿舍|寝|baisha|白沙/.test(key)) return "dorm";
  if (/medical|med|hospital|clinic|医|health|病/.test(key)) return "medical";
  if (/library|lib|book|图书|阅览/.test(key)) return "library";
  if (/theater|theatre|剧场|舞台/.test(key)) return "hall";
  return "";
}

export function resolveStoryBuildingEntry(hotspotId: HotspotId): StoryHotspotInteraction {
  const hotspot = getHotspotById(hotspotId);
  if (!hotspot) return { kind: "none" };
  const building = getStoryBuildingForHotspot(hotspot.id);
  if (building) {
    return { kind: "enter-building", hotspotId: hotspot.id, sceneId: hotspot.sceneId, building, storyMode: true };
  }
  return { kind: "open-story", hotspotId: hotspot.id, sceneId: hotspot.sceneId };
}

export function getInteriorStoryItems(roomKind: string): InteriorStoryItemDefinition[] {
  return INTERIOR_STORY_ITEMS[roomKind] ?? [];
}

export function getInteriorStoryTriggers(roomKind: string): InteriorStoryTriggerDefinition[] {
  return INTERIOR_STORY_TRIGGERS[roomKind] ?? [];
}

export function getStoryItemName(itemId: ItemId): string {
  return itemCatalog[itemId].name;
}

export function collectStoryItem(state: StoryState, rawItemId: string, fallbackName?: string): StoryItemCollectionResult {
  if (!isStoryItemId(rawItemId)) return { nextState: state, collected: false };
  if (state.inventory.includes(rawItemId)) return { nextState: state, collected: false, itemId: rawItemId };

  const name = fallbackName ?? itemCatalog[rawItemId].name;
  return {
    nextState: {
      ...state,
      inventory: [...state.inventory, rawItemId],
      log: appendStoryLog(state.log, `在建筑内拾取了「${name}」。`),
    },
    collected: true,
    itemId: rawItemId,
  };
}

export function shouldWaitForInteriorExitTrigger(
  activeScene: StoryScene,
  nextScene: StoryScene,
  inInterior: boolean,
): boolean {
  if (!inInterior || activeScene.setting !== "indoor" || nextScene.setting !== "outdoor") return false;
  return Boolean(INTERIOR_EXIT_TRIGGER_AFTER[activeScene.id]?.includes(nextScene.id));
}

export function resolvePostChoiceCommands(args: {
  activeScene: StoryScene;
  nextScene: StoryScene;
  nextHotspot: ReturnType<typeof getHotspotById>;
  changesLocation: boolean;
  inInterior: boolean;
}): StoryPostChoiceCommand[] {
  const { activeScene, nextScene, nextHotspot, changesLocation, inInterior } = args;
  const commands: StoryPostChoiceCommand[] = [];
  const waitForInteriorExit = shouldWaitForInteriorExitTrigger(activeScene, nextScene, inInterior);

  if (activeScene.setting === "indoor" && nextScene.setting === "outdoor" && !waitForInteriorExit) {
    commands.push({ kind: "exit-interior" });
  }

  const hotspot = getHotspotById(activeScene.locationId);
  if (!inInterior && nextScene.setting === "indoor" && hotspot?.mode === "outdoor-to-indoor") {
    commands.push({ kind: "set-active-scene", sceneId: null });
    commands.push({ kind: "enter-building", hotspotId: hotspot.id });
  } else if (nextScene.ending) {
    commands.push({ kind: "set-active-scene", sceneId: nextScene.id });
  } else if (inInterior && nextScene.setting === "indoor") {
    // Same building & same locationId? Check if the next scene has a trigger in this room.
    // If yes → wait for the player to walk to the red dot.
    // If no  → show the next scene as a popup immediately (no trigger to walk to).
    if (nextScene.locationId === activeScene.locationId) {
      const roomKind = inferRoomKindForLocation(nextScene.locationId);
      const triggers = getInteriorStoryTriggers(roomKind);
      const hasTrigger = triggers.some((t) => t.activeSceneIds.includes(nextScene.id));
      commands.push({ kind: "set-active-scene", sceneId: hasTrigger ? null : nextScene.id });
    } else {
      commands.push({ kind: "set-active-scene", sceneId: null });
    }
  } else if (waitForInteriorExit) {
    commands.push({ kind: "set-active-scene", sceneId: null });
  } else if (!changesLocation) {
    commands.push({ kind: "set-active-scene", sceneId: nextScene.id });
  } else {
    commands.push({ kind: "set-active-scene", sceneId: null });
    if (nextHotspot) commands.push({ kind: "show-objective", place: nextHotspot.place, objective: nextHotspot.objective });
  }

  return commands;
}

export function resolveInteriorExitTrigger(state: StoryState): StorySceneId | null {
  const scene = storyScenes[state.currentSceneId];
  return scene.setting === "outdoor" ? scene.id : null;
}

export function isChoiceLocked(choice: StoryChoice, state: StoryState) {
  if (choice.requireItem && !state.inventory.includes(choice.requireItem)) return true;
  if (choice.requireFlag && !state.flags[choice.requireFlag]) return true;
  return false;
}

function applyStatChanges(state: StoryState, changes?: Partial<Record<StatKey, number>>) {
  const nextStats = { ...state.stats };
  const nextInventory = [...state.inventory];
  let blockedByTalisman = false;

  (Object.entries(changes ?? {}) as Array<[StatKey, number]>).forEach(([key, value]) => {
    if (key === "sanity" && value < -5 && nextInventory.includes("talisman")) {
      nextInventory.splice(nextInventory.indexOf("talisman"), 1);
      blockedByTalisman = true;
      return;
    }
    nextStats[key] = clampStat(nextStats[key] + value);
  });

  return { stats: nextStats, inventory: nextInventory, blockedByTalisman };
}

export function useStoryInventoryItem(state: StoryState, itemId: ItemId): InventoryUseResult {
  if ((itemId !== "medicine" && itemId !== "energy") || !state.inventory.includes(itemId)) {
    return { nextState: state, used: false };
  }

  const inventory = state.inventory.filter((id) => id !== itemId);
  const stats = { ...state.stats };
  if (itemId === "medicine") stats.sanity = clampStat(stats.sanity + 20);
  if (itemId === "energy") stats.stamina = clampStat(stats.stamina + 30);

  return {
    nextState: {
      ...state,
      stats,
      inventory,
      log: appendStoryLog(state.log, itemId === "medicine" ? "服用镇定药，理智恢复。" : "饮用能量饮料，体力恢复。"),
    },
    used: true,
    effect: "reveal",
  };
}

export function advanceStory(state: StoryState, activeScene: StoryScene, choice: StoryChoice): StoryTransition | null {
  if (isChoiceLocked(choice, state)) return null;

  const currentLocation = activeScene.locationId;
  const applied = applyStatChanges(state, choice.statChanges);
  const gainedItems = uniqueStoryValues([
    ...applied.inventory,
    ...(choice.gainItem ? [choice.gainItem] : []),
    ...(choice.gainItems ?? []),
  ]);
  const nextFlags = { ...state.flags };
  if (choice.setFlag) nextFlags[choice.setFlag] = true;

  let nextStats = { ...applied.stats };
  let nextSceneId = choice.next;
  if (nextStats.sanity <= 0) nextSceneId = "death_sanity";
  if (nextSceneId.startsWith("ending") && nextStats.sanity <= 20 && nextStats.clues >= 15) {
    nextSceneId = "ending_nightmare";
  }

  const nextScene = storyScenes[nextSceneId];
  const nextHotspot = getHotspotById(nextScene.locationId);
  const changesLocation = nextScene.locationId !== currentLocation;
  const completedHotspots = uniqueStoryValues(
    changesLocation || nextScene.ending ? [...state.completedHotspots, currentLocation] : state.completedHotspots,
  );

  const itemLine = choice.gainItem
    ? `获得「${itemCatalog[choice.gainItem].name}」。`
    : choice.gainItems?.length
      ? `获得${choice.gainItems.map((id) => `「${itemCatalog[id].name}」`).join("、")}。`
      : "";
  const talismanLine = applied.blockedByTalisman ? "护身符发热，替你挡下了一次精神侵蚀。" : "";
  const nextPlaceLine = changesLocation && !nextScene.ending && nextHotspot ? `下一站：${nextHotspot.place}` : "";

  return {
    nextState: {
      ...state,
      currentSceneId: nextSceneId,
      stats: nextStats,
      inventory: gainedItems,
      flags: nextFlags,
      visitedHotspots: uniqueStoryValues([...state.visitedHotspots, currentLocation]),
      completedHotspots,
      log: appendStoryLog(state.log, [choice.text, talismanLine, itemLine, nextPlaceLine].filter(Boolean).join(" ")),
    },
    nextScene,
    nextHotspot,
    changesLocation,
    effect: choice.effect ?? nextScene.effect,
  };
}

export function visitStoryHotspot(state: StoryState, scene: StoryScene) {
  return {
    ...state,
    visitedHotspots: uniqueStoryValues([...state.visitedHotspots, scene.locationId]),
    log: appendStoryLog(state.log, `抵达 ${getHotspotById(scene.locationId)?.place ?? scene.title}`),
  };
}

export function validateStoryGraph(): StoryGraphIssue[] {
  const issues: StoryGraphIssue[] = [];
  const hotspotIds = new Set(storyHotspots.map((hotspot) => hotspot.id));
  const sceneIds = new Set(Object.keys(storyScenes) as StorySceneId[]);

  Object.values(storyScenes).forEach((scene) => {
    if (!hotspotIds.has(scene.locationId)) {
      issues.push({ severity: "error", message: `${scene.id} points to missing hotspot ${scene.locationId}` });
    }
    scene.choices.forEach((choice) => {
      if (!sceneIds.has(choice.next)) {
        issues.push({ severity: "error", message: `${scene.id}/${choice.id} points to missing scene ${choice.next}` });
      }
    });
  });

  storyHotspots.forEach((hotspot) => {
    if (!sceneIds.has(hotspot.sceneId)) {
      issues.push({ severity: "error", message: `${hotspot.id} points to missing scene ${hotspot.sceneId}` });
    }
  });

  return issues;
}
