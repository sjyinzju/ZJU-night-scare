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
