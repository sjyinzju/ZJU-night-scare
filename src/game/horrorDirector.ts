import type { IsoPoint } from "./mapData";
import type { StoryHotspot } from "./storyData";
import type { GhostFSM } from "./store";

export type HorrorDirectorInput = {
  currentFsm: GhostFSM;
  playerIso: IsoPoint;
  ghostIso: IsoPoint;
  activeHotspot?: StoryHotspot;
  sanity: number;
  storyStage: number;
  lastSanityHitAt: number;
  time: number;
};

export type HorrorDirectorDecision = {
  fsm: GhostFSM;
  speed: number;
  target: IsoPoint;
  routeRefreshMs: number;
  auraAlpha: number;
};

export type HorrorDirectorConfig = {
  baseSpeed: number;
  chaseSpeed: number;
  stalkSpeed: number;
  caughtRadius: number;
  chaseDistance: number;
  stalkDistance: number;
  retreatDuration: number;
  routeRefreshMs: number;
};

export function decideGhostAction(input: HorrorDirectorInput, config: HorrorDirectorConfig): HorrorDirectorDecision {
  const playerDistance = Math.hypot(input.ghostIso.x - input.playerIso.x, input.ghostIso.y - input.playerIso.y);
  const lowSanityPressure = input.sanity <= 35 ? 0.45 : 0;
  const lateStoryPressure = input.storyStage >= 3 ? 0.25 : 0;
  const chaseDistance = config.chaseDistance + lowSanityPressure + lateStoryPressure;
  const stalkDistance = config.stalkDistance + lateStoryPressure;

  let fsm: GhostFSM = input.currentFsm;
  if (playerDistance <= config.caughtRadius || playerDistance <= chaseDistance) {
    fsm = "chasing";
  } else if (input.currentFsm === "retreating") {
    const elapsed = input.time - (input.lastSanityHitAt || input.time);
    fsm = elapsed > config.retreatDuration ? "stalking" : "retreating";
  } else if (input.activeHotspot && input.storyStage >= 2 && playerDistance > chaseDistance + 0.8) {
    fsm = "ambush";
  } else if (playerDistance <= stalkDistance) {
    fsm = input.currentFsm === "chasing" ? "chasing" : "stalking";
  } else {
    fsm = "stalking";
  }

  const speed =
    fsm === "chasing"
      ? config.chaseSpeed
      : fsm === "ambush"
        ? config.stalkSpeed * 0.7
        : fsm === "retreating"
          ? config.chaseSpeed
          : config.stalkSpeed;
  const target = fsm === "ambush" && input.activeHotspot ? input.activeHotspot : input.playerIso;
  const auraAlpha = fsm === "chasing" ? 0.7 : fsm === "stalking" ? 0.35 : fsm === "ambush" ? 0.24 : 0.16;
  const routeRefreshMs = fsm === "chasing" ? Math.max(520, config.routeRefreshMs * 0.58) : config.routeRefreshMs;

  return { fsm, speed, target, routeRefreshMs, auraAlpha };
}
