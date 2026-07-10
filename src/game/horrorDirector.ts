import type { IsoPoint } from "./mapData";
import type { StoryHotspot } from "./storyData";

// ── 鬼状态机（升级版 — 新增 patrol 巡逻状态）──
export type GhostFSM =
  | "hidden"       // 不可见，等待生成计时
  | "patrol"       // 按预设路径巡逻，视线范围内检测到玩家进入追踪
  | "stalking"     // 追踪玩家，保持中等距离
  | "ambush"       // 在下一个热点附近潜伏等待
  | "chasing"      // 近距离全速追击
  | "retreating";  // 被驱退

export type HorrorDirectorInput = {
  currentFsm: GhostFSM;
  playerIso: IsoPoint;
  ghostIso: IsoPoint;
  /** 鬼当前朝向（巡逻方向），用于视线锥检测 */
  ghostFacing?: IsoPoint;
  activeHotspot?: StoryHotspot;
  sanity: number;
  storyStage: number;
  lastSanityHitAt: number;
  time: number;
  /** 玩家是否在奔跑（发出噪音，更容易被鬼察觉） */
  playerIsRunning?: boolean;
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
  patrolSpeed: number;
  caughtRadius: number;
  chaseDistance: number;
  stalkDistance: number;
  retreatDuration: number;
  routeRefreshMs: number;
  /** 鬼的视野锥角度（弧度），默认 ~60° */
  viewConeAngle?: number;
  /** 鬼的最大视野距离（等距单位） */
  viewDistance?: number;
};

// ── 视线检测 ──

/**
 * 检测鬼是否能"看见"玩家。
 * - 玩家在鬼的视野锥内 (viewConeAngle)
 * - 玩家在鬼的视野距离内 (viewDistance)
 *
 * 返回 0-1 的"可见度"（越过距离衰减）。
 */
export function lineOfSightScore(
  ghostIso: IsoPoint,
  ghostFacing: IsoPoint | undefined,
  playerIso: IsoPoint,
  viewDistance: number,
  viewConeAngle: number,
): number {
  const dx = playerIso.x - ghostIso.x;
  const dy = playerIso.y - ghostIso.y;
  const dist = Math.hypot(dx, dy);
  if (dist > viewDistance) return 0;

  // 距离衰减：越近越易被看到
  const distScore = 1 - dist / viewDistance;

  if (!ghostFacing || (ghostFacing.x === 0 && ghostFacing.y === 0)) {
    // 无朝向信息 → 视为"能感知周围"，但距离衰减仍适用
    return distScore * 0.5;
  }

  // 朝向与玩家方向的角度差
  const fx = ghostFacing.x;
  const fy = ghostFacing.y;
  const facingLen = Math.hypot(fx, fy);
  if (facingLen < 0.001) return distScore * 0.5;
  const ndx = dx / dist;
  const ndy = dy / dist;
  const nfx = fx / facingLen;
  const nfy = fy / facingLen;
  const dot = ndx * nfx + ndy * nfy;
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)));

  if (angle > viewConeAngle) return 0; // 在视野锥外

  const angleScore = 1 - angle / viewConeAngle;
  return distScore * angleScore;
}

// ── 决策引擎 ──

export function decideGhostAction(
  input: HorrorDirectorInput,
  config: HorrorDirectorConfig,
): HorrorDirectorDecision {
  const playerDistance = Math.hypot(
    input.ghostIso.x - input.playerIso.x,
    input.ghostIso.y - input.playerIso.y,
  );

  // ── 动态压力：低理智 +20%，后期剧情 +15%，奔跑 +30% ──
  const lowSanityPressure = input.sanity <= 35 ? 0.55 : 0;
  const lateStoryPressure = input.storyStage >= 3 ? 0.30 : 0;
  const runningPressure = input.playerIsRunning ? 0.45 : 0;
  const totalPressure = lowSanityPressure + lateStoryPressure + runningPressure;

  const chaseDistance = config.chaseDistance + totalPressure;
  const stalkDistance = config.stalkDistance + totalPressure * 0.7;

  const viewDist = config.viewDistance ?? 8;
  const viewCone = config.viewConeAngle ?? Math.PI / 3; // 60°

  // ── 视线检测 ──
  const losScore = lineOfSightScore(
    input.ghostIso,
    input.ghostFacing,
    input.playerIso,
    viewDist,
    viewCone,
  );

  const hasLos = losScore > 0.35; // 可见度阈值

  // ── 声音检测：奔跑声大幅增加鬼的感知范围 ──
  const soundBonus = input.playerIsRunning ? 1.8 : 1.0;
  const effectivePlayerDist = playerDistance / soundBonus;

  let fsm: GhostFSM = input.currentFsm;

  // 被抓住 → 追击
  if (playerDistance <= config.caughtRadius) {
    fsm = "chasing";
  }
  // 视线捕捉到玩家或距离很近 → 追击
  else if (hasLos || effectivePlayerDist <= chaseDistance) {
    fsm = "chasing";
  }
  // 正在撤退 → 检查冷却
  else if (input.currentFsm === "retreating") {
    const elapsed = input.time - (input.lastSanityHitAt || input.time);
    fsm = elapsed > config.retreatDuration ? "stalking" : "retreating";
  }
  // 有活跃热点且剧情中后段 → 伏击
  else if (input.activeHotspot && input.storyStage >= 2 && effectivePlayerDist > chaseDistance + 0.8) {
    fsm = "ambush";
  }
  // 中等距离 → 追踪
  else if (effectivePlayerDist <= stalkDistance) {
    fsm = input.currentFsm === "chasing" ? "chasing" : "stalking";
  }
  // 距离较远、没有直接威胁 → 巡逻
  else if (input.currentFsm === "patrol" || input.currentFsm === "stalking") {
    fsm = effectivePlayerDist > stalkDistance * 1.4 ? "patrol" : "stalking";
  }
  // 默认 → 追踪
  else {
    fsm = "stalking";
  }

  // ── 速度映射 ──
  const speed =
    fsm === "chasing"
      ? config.chaseSpeed
      : fsm === "ambush"
        ? config.stalkSpeed * 0.7
        : fsm === "retreating"
          ? config.chaseSpeed
          : fsm === "patrol"
            ? config.patrolSpeed
            : config.stalkSpeed;

  const target =
    fsm === "ambush" && input.activeHotspot
      ? input.activeHotspot
      : fsm === "patrol"
        ? input.ghostIso // 巡逻时沿当前方向缓慢移动
        : input.playerIso;

  const auraAlpha =
    fsm === "chasing"
      ? 0.74
      : fsm === "stalking"
        ? 0.38
        : fsm === "ambush"
          ? 0.24
          : fsm === "patrol"
            ? 0.15
            : 0.16;

  const routeRefreshMs =
    fsm === "chasing"
      ? Math.max(400, config.routeRefreshMs * 0.45)
      : fsm === "patrol"
        ? config.routeRefreshMs * 2.5 // 巡逻时路线更新更慢
        : config.routeRefreshMs;

  return { fsm, speed, target, routeRefreshMs, auraAlpha };
}
