import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal, flushSync } from "react-dom";
import Phaser from "phaser";
import {
  Backpack,
  BadgeCheck,
  Brain,
  CircleDot,
  Footprints,
  HandHeart,
  Heart,
  HeartPulse,
  MapPin,
  RadioTower,
  Search,
  Sparkles,
} from "lucide-react";
import { CampusScene, type GameHudEvent, type GameMiniMapEvent } from "./game/CampusScene";
import InteriorOverlay from "./game/interior3d/InteriorOverlay";
import type { InteriorAssetState } from "./game/interior3d/Interior3D";
import { preloadInteriorAsset } from "./game/interior3d/InteriorAssetLoader";
import { shouldUseBaishaDirectChaseTest } from "./game/interior3d/baishaDebug";
import LaunchSequence, { type LaunchSequenceMode } from "./LaunchSequence";
import { campusBuildings, campusRoads, type IsoPoint } from "./game/mapData";
import {
  getHotspotById,
  getSceneHotspot,
  itemCatalog,
  storyHotspots,
  storyScenes,
  type HorrorEffect,
  type HotspotId,
  type ItemId,
  type StatKey,
  type StoryChoice,
  type StoryResultOption,
  type StorySceneId,
} from "./game/storyData";
import { useGameAudio } from "./game/audio/useGameAudio";
import { audioManager } from "./game/audio/audioManager";
import { playImpactBang } from "./game/audio/proceduralAudio";
import { assetUrl } from "./game/assetPath";
import { INITIAL_REVIVES, REVIVE_SANITY, useGameStore, type GameStore } from "./game/store";
import { pickJumpscareText, contextForHotspot, textVariantClass, type JumpscareContext } from "./game/jumpscareTexts";
import { JumpscarePipeline } from "./game/JumpscarePipeline";
import {
  JUMPSCARE_SPRITE_IDS,
  jumpscareSpriteUrl,
  preloadJumpscareSprites,
  prepareJumpscareSprite,
  type JumpscareSpriteId,
} from "./game/jumpscareAssets";
import {
  advanceStory,
  applyGhostDamage,
  collectStoryItem,
  getStoryBuildingForHotspot,
  isChoiceLocked,
  resolveGameStartBuilding,
  resolveInteriorExitTrigger,
  resolvePostChoiceCommands,
  storyStageFromSceneId,
  useStoryInventoryItem,
  visitStoryHotspot,
} from "./game/storyEngine";

const initialHud: GameHudEvent = {
  place: "",
  prompt: "",
  activeHotspotId: undefined,
};

const MINI_MAP_W = 42;
const MINI_MAP_D = 34;

type MiniMapSnapshot = {
  player: IsoPoint;
  ghost?: IsoPoint;
  ghostVisible: boolean;
};

type DocumentView = { title: string; lines: string[] };

// Normal development follows the complete story from scene 01. Keep Baisha's
// direct-entry path explicit so it remains available for focused QA only.
const BAISHA_DEVELOPMENT_START = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get("baishaDev") === "1";
const BAISHA_CHASE_ONLY = shouldUseBaishaDirectChaseTest();
const BAISHA_DEVELOPMENT_PLAYER = new URLSearchParams(window.location.search).get("baishaDoor") === "1"
  ? { x: 7.6, y: 8.11 }
  : { x: 19.4, y: 30.2 };

function createBaishaDevelopmentStoryState(chaseOnly = false): GameStore["storyState"] {
  return {
    currentSceneId: chaseOnly ? "dorm_forum" : "dorm_baiqiu",
    stats: { sanity: 73, stamina: 76, clues: 31, trust: 54, affection: 0 },
    inventory: ["flashlight", "receipt", "talisman"],
    flags: {
      talisman_collected: true,
      library_fall_witnessed: true,
      ...(chaseOnly ? { readForum: true } : {}),
    },
    visitedHotspots: ["library"],
    completedHotspots: ["library"],
    log: [
      "你带着借阅小票和从农医馆取得的符纸回到校园。",
      "林伟坠楼前留下的线索指向白沙宿舍。",
    ],
  };
}

/** 同步判定是否为触摸/移动设备:窄屏 + 触摸能力任一满足即视为移动端。 */
function detectMobile(): boolean {
  if (typeof window === "undefined") return false;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const narrow = window.matchMedia("(max-width: 820px)").matches;
  const touch = (navigator.maxTouchPoints ?? 0) > 0 || "ontouchstart" in window;
  return (coarse && touch) || (narrow && touch);
}

/** isMobile hook。首帧即同步取真值(供 Phaser 创建时决定画质),之后随视口变化更新。 */
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(detectMobile);
  useEffect(() => {
    const detect = () => setIsMobile(detectMobile());
    const mq = window.matchMedia("(max-width: 820px)");
    mq.addEventListener?.("change", detect);
    window.addEventListener("resize", detect);
    return () => {
      mq.removeEventListener?.("change", detect);
      window.removeEventListener("resize", detect);
    };
  }, []);
  return isMobile;
}

const JOY_RADIUS = 46;

/** 外层地图的虚拟摇杆。onMove 传出屏幕坐标向量(x 右正、y 下正)，范围约 [-1,1]。 */
function MapJoystick({ onMove }: { onMove: (x: number, y: number) => void }): React.ReactElement {
  const knobRef = useRef<HTMLDivElement>(null);
  const pointerId = useRef<number | null>(null);
  const origin = useRef({ x: 0, y: 0 });

  const resetJoystick = useCallback(() => {
    pointerId.current = null;
    if (knobRef.current) knobRef.current.style.transform = "translate(0px, 0px)";
    onMove(0, 0);
  }, [onMove]);

  useEffect(() => {
    const handlePointerRelease = (event: PointerEvent) => {
      if (pointerId.current === event.pointerId) resetJoystick();
    };
    const handleVisibilityChange = () => {
      if (document.hidden) resetJoystick();
    };
    window.addEventListener("pointerup", handlePointerRelease);
    window.addEventListener("pointercancel", handlePointerRelease);
    window.addEventListener("blur", resetJoystick);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pointerup", handlePointerRelease);
      window.removeEventListener("pointercancel", handlePointerRelease);
      window.removeEventListener("blur", resetJoystick);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      resetJoystick();
    };
  }, [resetJoystick]);

  const onDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    pointerId.current = e.pointerId;
    const rect = e.currentTarget.getBoundingClientRect();
    origin.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Safari can reject capture after an interrupted gesture. Window-level
      // release listeners below still guarantee that movement is reset.
    }
    onMove(0, 0);
  }, [onMove]);

  const onMovePointer = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (pointerId.current !== e.pointerId) return;
      e.preventDefault();
      let dx = e.clientX - origin.current.x;
      let dy = e.clientY - origin.current.y;
      const dist = Math.hypot(dx, dy);
      if (dist > JOY_RADIUS) {
        dx = (dx / dist) * JOY_RADIUS;
        dy = (dy / dist) * JOY_RADIUS;
      }
      if (knobRef.current) knobRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
      onMove(dx / JOY_RADIUS, dy / JOY_RADIUS);
    },
    [onMove],
  );

  const onUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (pointerId.current !== e.pointerId) return;
      resetJoystick();
    },
    [resetJoystick],
  );

  return (
    <div
      className="touchJoystick"
      onPointerDown={onDown}
      onPointerMove={onMovePointer}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onLostPointerCapture={resetJoystick}
      aria-label="移动摇杆"
    >
      <div ref={knobRef} className="touchJoyKnob" />
    </div>
  );
}

const statMeta: Record<StatKey, { label: string; icon: typeof Brain; dangerBelow?: number }> = {
  sanity: { label: "理智", icon: Brain, dangerBelow: 30 },
  stamina: { label: "体力", icon: Footprints, dangerBelow: 25 },
  clues: { label: "线索", icon: Search },
  trust: { label: "信任", icon: HandHeart },
  affection: { label: "好感", icon: Heart },
};

function statDeltaText(changes?: Partial<Record<StatKey, number>>) {
  if (!changes) return "";
  return (Object.entries(changes) as Array<[StatKey, number]>)
    .filter(([key, value]) => value !== 0 && statMeta[key])
    .map(([key, value]) => `${statMeta[key].label}${value > 0 ? "+" : ""}${value}`)
    .join(" / ");
}

function storyTone(paragraph: string) {
  if (/砰|血|死|刀|尖叫|抓|崩溃|绳子仍在收紧|贴到背后/.test(paragraph)) return "shock";
  if (/突然|黑暗|警告|不要|不该|恐惧|没有|空无一人|很轻|低声/.test(paragraph)) return "tense";
  return "";
}

function drawMiniMap(canvas: HTMLCanvasElement, snapshot: MiniMapSnapshot) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const dpr = window.devicePixelRatio || 1;
  const width = Math.floor(rect.width * dpr);
  const height = Math.floor(rect.height * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const pad = 12;
  const toMini = (point: IsoPoint) => ({
    x: pad + (point.x / MINI_MAP_W) * (rect.width - pad * 2),
    y: pad + (point.y / MINI_MAP_D) * (rect.height - pad * 2),
  });

  ctx.fillStyle = "rgba(4, 10, 9, 0.82)";
  ctx.fillRect(0, 0, rect.width, rect.height);
  ctx.strokeStyle = "rgba(194, 211, 191, 0.24)";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, rect.width - 1, rect.height - 1);

  campusBuildings.forEach((building) => {
    const topLeft = toMini({ x: building.x, y: building.y });
    const bottomRight = toMini({ x: building.x + building.w, y: building.y + building.d });
    ctx.fillStyle = building.zone === "story" ? "rgba(181, 82, 91, 0.42)" : "rgba(130, 146, 137, 0.34)";
    ctx.fillRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
  });

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  campusRoads.forEach((road) => {
    ctx.beginPath();
    road.points.forEach((point, index) => {
      const p = toMini(point);
      if (index === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.strokeStyle = "rgba(214, 226, 204, 0.58)";
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  const player = toMini(snapshot.player);
  ctx.fillStyle = "#e7f8ff";
  ctx.shadowColor = "rgba(185, 238, 255, 0.72)";
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(player.x, player.y, 4.2, 0, Math.PI * 2);
  ctx.fill();

  if (snapshot.ghostVisible && snapshot.ghost) {
    const ghost = toMini(snapshot.ghost);
    ctx.fillStyle = "#ff1d1d";
    ctx.shadowColor = "rgba(255, 0, 0, 0.88)";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(ghost.x, ghost.y, 4.8, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.shadowBlur = 0;
}

function App() {
  const scene01Debug = new URLSearchParams(window.location.search).get("debugScene01") === "1";
  const gameRef = useRef<Phaser.Game | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const particleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const miniMapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const miniMapSnapshotRef = useRef<MiniMapSnapshot>({ player: { x: 19.4, y: 30.2 }, ghostVisible: false });
  const miniMapFrameRef = useRef<number | null>(null);
  const choiceTimerRef = useRef<number | null>(null);
  const receiptRevealTimerRef = useRef<number | null>(null);
  const effectClearTimerRef = useRef<number | null>(null);
  const effectStartFrameRef = useRef<number | null>(null);
  const jumpscareRequestRef = useRef(0);
  const [hud, setHud] = useState<GameHudEvent>(initialHud);
  const [gameSessionId, setGameSessionId] = useState(0);
  const [phaserReady, setPhaserReady] = useState(false);
  const [launchMode, setLaunchMode] = useState<LaunchSequenceMode | null>(null);
  const [launchAssetState, setLaunchAssetState] = useState<InteriorAssetState>("loading");
  const [assetLoadAttempt, setAssetLoadAttempt] = useState(0);
  const [documentView, setDocumentView] = useState<DocumentView | null>(null);
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);
  const [pendingChoiceResult, setPendingChoiceResult] = useState<StoryChoice | null>(null);
  const [pendingResultOption, setPendingResultOption] = useState<StoryResultOption | null>(null);
  const [storyClosing, setStoryClosing] = useState(false);
  const [jumpscareSprite, setJumpscareSprite] = useState<JumpscareSpriteId | null>(null);
  const [exitBlackout, setExitBlackout] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    // Start downloads at app mount and retain the decoded images for the whole
    // session. Howler also preloads, but this gives the jumpscare coordinator a
    // concrete readiness promise before it starts a one-shot beat.
    void preloadJumpscareSprites();
    void audioManager.prepareJumpscare();
  }, []);

  useEffect(() => () => {
    if (effectClearTimerRef.current !== null) window.clearTimeout(effectClearTimerRef.current);
    if (effectStartFrameRef.current !== null) window.cancelAnimationFrame(effectStartFrameRef.current);
  }, []);

  // ── Zustand is the single source of truth for the playable session. ──
  const storyState = useGameStore((s) => s.storyState);
  const setStoryState = useGameStore((s) => s.setStoryState);
  const activeSceneId = useGameStore((s) => s.activeSceneId);
  const setActiveSceneId = useGameStore((s) => s.setActiveSceneId);
  const screenEffect = useGameStore((s) => s.screenEffect);
  const setScreenEffect = useGameStore((s) => s.setScreenEffect);
  const nextObjectiveCue = useGameStore((s) => s.nextObjectiveCue);
  const setNextObjectiveCue = useGameStore((s) => s.setNextObjectiveCue);
  const gameStarted = useGameStore((s) => s.gameStarted);
  const world = useGameStore((s) => s.world);
  const interiorBuilding = useGameStore((s) => s.interiorBuilding);
  const nearBuilding = useGameStore((s) => s.nearBuilding);
  const revivesRemaining = useGameStore((s) => s.revivesRemaining);
  const revive = useGameStore((s) => s.revive);
  const reviveInterior = useGameStore((s) => s.reviveInterior);
  const startSession = useGameStore((s) => s.startSession);
  const openInterior = useGameStore((s) => s.openInterior);
  const closeInterior = useGameStore((s) => s.closeInterior);
  const setWorld = useGameStore((s) => s.setWorld);
  const resetAll = useGameStore((s) => s.resetAll);
  const setPlayerIso = useGameStore((s) => s.setPlayerIso);

  // ── View-only Zustand subscriptions. ──
  const zHudPlace = useGameStore((s) => s.hudPlace);
  const zHudPrompt = useGameStore((s) => s.hudPrompt);
  const zHudHotspot = useGameStore((s) => s.hudActiveHotspotId);
  const zMiniMap = useGameStore((s) => s.miniMap);
  const zJumpscareText = useGameStore((s) => s.jumpscareText);

  // 同步 HUD
  useEffect(() => {
    setHud({ place: zHudPlace, prompt: zHudPrompt, activeHotspotId: zHudHotspot });
  }, [zHudPlace, zHudPrompt, zHudHotspot]);

  // 同步小地图
  useEffect(() => {
    miniMapSnapshotRef.current = zMiniMap;
    if (miniMapCanvasRef.current) {
      if (miniMapFrameRef.current !== null) window.cancelAnimationFrame(miniMapFrameRef.current);
      miniMapFrameRef.current = window.requestAnimationFrame(() => {
        miniMapFrameRef.current = null;
        drawMiniMap(miniMapCanvasRef.current!, zMiniMap);
      });
    }
  }, [zMiniMap]);

  const jumpscareText = zJumpscareText;
  const jumpscareVariant = textVariantClass(zJumpscareText);

  const currentScene = storyScenes[storyState.currentSceneId];
  const activeScene = activeSceneId ? storyScenes[activeSceneId] : null;
  const targetHotspotId = getSceneHotspot(storyState.currentSceneId);
  const targetHotspot = getHotspotById(targetHotspotId);
  const { playEffect, playChoice, playHover, playItem, playGhostHit, resetAudio } = useGameAudio({
    sanity: storyState.stats.sanity,
    activeStory: Boolean(activeSceneId),
    ending: activeScene?.ending,
  });

  // ── 统一的恐怖效果触发器（音频 + CSS 叠加层 + 惊吓文字 + 相机抖动）──
  // 被 handleOpenStory / handleInteriorStory / choose / ghost-hit 等所有路径复用。
  const triggerEffect = useCallback(
    (
      effect?: HorrorEffect,
      context?: JumpscareContext,
      spriteId?: JumpscareSpriteId,
      customMessage?: string,
      durationMs?: number,
    ) => {
      if (!effect) return;
      if (effectClearTimerRef.current !== null) {
        window.clearTimeout(effectClearTimerRef.current);
        effectClearTimerRef.current = null;
      }
      if (effectStartFrameRef.current !== null) {
        window.cancelAnimationFrame(effectStartFrameRef.current);
        effectStartFrameRef.current = null;
      }

      const currentStoryState = useGameStore.getState().storyState;
      const effectContext = context ?? contextForHotspot(getSceneHotspot(currentStoryState.currentSceneId));
      const text = effect === "jumpscare" || effect === "shake"
        ? customMessage ?? pickJumpscareText(effectContext, currentStoryState.stats.sanity)
        : null;

      if (effect !== "jumpscare") {
        setScreenEffect(effect);
        playEffect(effect);
        if (text) useGameStore.getState().setJumpscareText(text);
        window.dispatchEvent(new CustomEvent("zju-horror-effect", { detail: { effect } }));
        effectClearTimerRef.current = window.setTimeout(() => {
          effectClearTimerRef.current = null;
          setScreenEffect("");
        }, durationMs ?? 520);
        return;
      }

      // Commit the complete inactive frame first. This makes repeated scares
      // restart their CSS animations and ensures text/sprite exist before the
      // sound and camera effect begin.
      flushSync(() => {
        setScreenEffect("");
        setJumpscareSprite(spriteId ?? null);
        if (text) useGameStore.getState().setJumpscareText(text);
      });

      effectStartFrameRef.current = window.requestAnimationFrame(() => {
        effectStartFrameRef.current = null;
        flushSync(() => setScreenEffect("jumpscare"));
        playEffect("jumpscare");
        window.dispatchEvent(new CustomEvent("zju-horror-effect", { detail: { effect: "jumpscare" } }));
        effectClearTimerRef.current = window.setTimeout(() => {
          effectClearTimerRef.current = null;
          setScreenEffect("");
          setJumpscareSprite(null);
        }, durationMs ?? 1300);
      });
    },
    [playEffect],
  );

  /** Story beats use the central jumpscare pipeline so sanity is charged once. */
  const triggerNarrativeEffect = useCallback(
    (effect: HorrorEffect | undefined, context: JumpscareContext) => {
      if (effect === "jumpscare") {
        JumpscarePipeline.executeStoryEffect(context, 0.62);
        return;
      }
      triggerEffect(effect, context);
    },
    [triggerEffect],
  );

  useEffect(() => {
    const canvas = particleCanvasRef.current;
    if (!canvas || interiorBuilding) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const particles = Array.from({ length: isMobile ? 42 : 90 }, (_, index) => ({
      x: Math.random(),
      y: Math.random(),
      speed: 0.00016 + (index % 7) * 0.000035,
      size: 0.5 + Math.random() * 1.8,
      alpha: 0.08 + Math.random() * 0.16,
    }));
    let frame = 0;
    let raf = 0;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    const draw = () => {
      frame += 1;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach((particle, index) => {
        particle.x += particle.speed * (1 + Math.sin(frame * 0.006 + index) * 0.4);
        particle.y += particle.speed * 0.36;
        if (particle.x > 1.06) particle.x = -0.06;
        if (particle.y > 1.06) particle.y = -0.06;

        ctx.fillStyle = `rgba(205, 220, 204, ${particle.alpha})`;
        ctx.beginPath();
        ctx.arc(particle.x * canvas.width, particle.y * canvas.height, particle.size, 0, Math.PI * 2);
        ctx.fill();
      });
      raf = window.requestAnimationFrame(draw);
    };

    resize();
    draw();
    window.addEventListener("resize", resize);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [gameSessionId, interiorBuilding, isMobile]);

  useEffect(() => {
    const canvas = miniMapCanvasRef.current;
    if (!canvas) return;

    const scheduleDraw = () => {
      if (miniMapFrameRef.current !== null) return;
      miniMapFrameRef.current = window.requestAnimationFrame(() => {
        miniMapFrameRef.current = null;
        drawMiniMap(canvas, miniMapSnapshotRef.current);
      });
    };

    drawMiniMap(canvas, miniMapSnapshotRef.current);
    window.addEventListener("resize", scheduleDraw);
    return () => {
      if (miniMapFrameRef.current !== null) window.cancelAnimationFrame(miniMapFrameRef.current);
      miniMapFrameRef.current = null;
      window.removeEventListener("resize", scheduleDraw);
    };
  }, []);

  useEffect(() => {
    const handleOpenStory = (event: Event) => {
      const detail = (event as CustomEvent<{ hotspotId: HotspotId; sceneId: StorySceneId }>).detail;
      const sceneId = currentScene.locationId === detail.hotspotId ? storyState.currentSceneId : detail.sceneId;
      const scene = storyScenes[sceneId];

      // Baisha is a 78 MB authored scene. Mount it behind the entry veil as
      // soon as the warning opens, so model parsing, collision projection and
      // GPU preparation happen while the player reads instead of after choice.
      if (scene.id === "dorm_baiqiu") {
        const building = getStoryBuildingForHotspot("dorm");
        if (building) {
          setLaunchAssetState("loading");
          openInterior(building);
        }
      }

      setStoryState((previous) => visitStoryHotspot(previous, scene));
      setActiveSceneId(sceneId);
      // 统一走 triggerEffect：音频 + CSS 叠加层 + 惊吓文字 + 相机抖动全部到位
      triggerNarrativeEffect(scene.effect, contextForHotspot(scene.locationId));
    };

    window.addEventListener("zju-horror-open-story", handleOpenStory);
    return () => {
      window.removeEventListener("zju-horror-open-story", handleOpenStory);
    };
  }, [currentScene.locationId, openInterior, storyState.currentSceneId, triggerNarrativeEffect]);

  // 3D 内景中的故事触发区 → 弹出文字弹窗（覆盖在 3D 画面上）
  useEffect(() => {
    const handleInteriorStory = (event: Event) => {
      const { sceneId } = (event as CustomEvent<{ sceneId: string }>).detail;
      const sid = sceneId as StorySceneId;
      if (!storyScenes[sid]) return;
      const scene = storyScenes[sid];
      setStoryState((previous) => visitStoryHotspot(previous, scene));
      if (sid === "library_fall") {
        playImpactBang();
        const text = pickJumpscareText("library_fall", useGameStore.getState().storyState.stats.sanity);
        JumpscarePipeline.executeStoryEffect("library_fall", 0.92, text, "library-fall", 0);
        window.setTimeout(() => setActiveSceneId(sid), 1420);
        return;
      }
      setActiveSceneId(sid);
      triggerNarrativeEffect(scene.effect, contextForHotspot(scene.locationId));
    };
    window.addEventListener("zju-horror-interior-story", handleInteriorStory);
    return () => window.removeEventListener("zju-horror-interior-story", handleInteriorStory);
  }, [playEffect, triggerNarrativeEffect]);

  useEffect(() => {
    if (!phaserReady || !containerRef.current) return;
    // Destroy previous game instance so the player position, dead flag,
    // and all scene state reset on restart.
    if (gameRef.current) {
      gameRef.current.destroy(true);
      gameRef.current = null;
    }

    gameRef.current = new Phaser.Game({
      type: Phaser.AUTO,
      parent: containerRef.current,
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      backgroundColor: "#0b1110",
      scene: CampusScene,
      physics: {
        default: "arcade",
        arcade: { debug: false },
      },
      audio: {
        noAudio: true,
      },
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      render: {
        // 移动端关抗锯齿，减轻高 DPI 手机的填充率压力，换取流畅度。
        antialias: !isMobile,
        pixelArt: false,
      },
    });

    // Phaser 初始化完成后再补发一次当前状态，确保它不会错过事件
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("zju-horror-interior-state", { detail: { open: Boolean(interiorBuilding) } }));
    }, 100);

    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, [phaserReady, gameSessionId]);

  useEffect(() => {
    // 从当前剧情状态推导 StoryStage（驱动鬼AI、氛围、视觉特效）
    const storyStage = storyStageFromSceneId(storyState.currentSceneId);
    window.dispatchEvent(
      new CustomEvent("zju-horror-map-state", {
        detail: {
          guideHotspotId: targetHotspotId,
          completedHotspotIds: storyState.completedHotspots,
          visitedHotspotIds: storyState.visitedHotspots,
          sanity: storyState.stats.sanity,
          activeStory: Boolean(activeSceneId) || !gameStarted,
          storyStage,
          activeSceneId: activeSceneId ?? null,
        },
      }),
    );
  }, [
    activeSceneId,
    gameStarted,
    storyState.completedHotspots,
    storyState.currentSceneId,
    storyState.stats.sanity,
    storyState.visitedHotspots,
    targetHotspotId,
  ]);

  useEffect(() => {
    if (storyState.stats.sanity >= 30 || screenEffect) return;
    setScreenEffect("low-sanity");
  }, [screenEffect, storyState.stats.sanity]);

  useEffect(() => {
    if (!nextObjectiveCue) return;
    const timer = window.setTimeout(() => setNextObjectiveCue(null), 4200);
    return () => window.clearTimeout(timer);
  }, [nextObjectiveCue]);

  // 内景开合时通知 CampusScene 冻结/恢复外层移动。
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("zju-horror-interior-state", { detail: { open: Boolean(interiorBuilding) } }),
    );
    const game = gameRef.current;
    if (!game) return;
    if (interiorBuilding) game.loop.sleep();
    else game.loop.wake();
  }, [interiorBuilding]);

  // 内景里拾取的道具加入剧情物品栏(去重),对后续文字剧情选项有用。
  useEffect(() => {
    const onPickup = (event: Event) => {
      const { itemId, name } = (event as CustomEvent<{ itemId: string; name: string }>).detail;
      setStoryState((prev) => {
        if (itemId === "energy" && useGameStore.getState().interiorBuilding?.id === "dorm-baisha") {
          return {
            ...prev,
            flags: { ...prev.flags, baishaEnergyBoost: true },
            log: [`你喝下能量饮料，体力恢复，脚步也轻快了一些。`, ...prev.log].slice(0, 6),
          };
        }
        const collected = collectStoryItem(prev, itemId, name).nextState;
        if (itemId === "talisman" && prev.currentSceneId === "library_talisman") {
          return {
            ...collected,
            currentSceneId: "library_shelf",
            flags: { ...collected.flags, talisman_collected: true },
          };
        }
        return collected;
      });
      if (itemId === "receipt") {
        const text = pickJumpscareText(
          "library_receipt",
          useGameStore.getState().storyState.stats.sanity,
        );
        JumpscarePipeline.executeStoryEffect("library_receipt", 0.84, text, "library-shelf", 0);
        if (receiptRevealTimerRef.current !== null) {
          window.clearTimeout(receiptRevealTimerRef.current);
        }
        receiptRevealTimerRef.current = window.setTimeout(() => {
          receiptRevealTimerRef.current = null;
          setDocumentView({
            title: "借阅终端最后一条记录",
            lines: [
              "借阅人：　　　　",
              "索书号：R-1953 / 戏曲病理档案",
              "借出地点：农医馆一层",
              "归还地点：医学院地下仓库",
              "打印时间：23:47",
              "备注：　　　　",
              "纸背：有不规则压痕，暂时无法辨清。",
            ],
          });
        }, 1480);
      }
    };
    window.addEventListener("zju-horror-pickup", onPickup);
    return () => {
      window.removeEventListener("zju-horror-pickup", onPickup);
      if (receiptRevealTimerRef.current !== null) {
        window.clearTimeout(receiptRevealTimerRef.current);
      }
    };
  }, []);

  // 虚拟摇杆把移动向量注入到 Phaser 的 CampusScene。
  const handleJoystick = useCallback((x: number, y: number) => {
    window.dispatchEvent(new CustomEvent("zju-horror-map-move-input", {
      detail: { x, y },
    }));
  }, []);

  const enterNearBuilding = useCallback(() => {
    if (nearBuilding) openInterior(nearBuilding);
  }, [nearBuilding, openInterior]);

  const placePlayerAtInteriorExit = useCallback((buildingId?: string) => {
    if (!buildingId) return false;
    const exitPoint = campusBuildings.find((building) => building.id === buildingId)?.exitPoint;
    if (!exitPoint) return false;
    setPlayerIso({ ...exitPoint });
    window.dispatchEvent(new CustomEvent("zju-horror-player-relocate", {
      detail: { playerIso: { ...exitPoint } },
    }));
    return true;
  }, [setPlayerIso]);

  const leaveInterior = useCallback(() => {
    placePlayerAtInteriorExit(interiorBuilding?.id);
    closeInterior();
    setPhaserReady(true);
  }, [closeInterior, interiorBuilding?.id, placePlayerAtInteriorExit]);

  const leaveInteriorFromTrigger = useCallback(() => {
    if (interiorBuilding?.id === "dorm-baisha") {
      setExitBlackout(true);
      setStoryState((previous) => ({
        ...previous,
        currentSceneId: "find_yicheng",
        stats: { ...previous.stats, clues: Math.min(100, previous.stats.clues + 8) },
        inventory: previous.inventory.includes("diary")
          ? previous.inventory.filter((itemId) => itemId !== "energy")
          : [...previous.inventory.filter((itemId) => itemId !== "energy"), "diary"],
        flags: {
          ...previous.flags,
          readForum: true,
          baishaEscaped: true,
        },
        visitedHotspots: previous.visitedHotspots.includes("dorm")
          ? previous.visitedHotspots
          : [...previous.visitedHotspots, "dorm"],
        completedHotspots: previous.completedHotspots.includes("dorm")
          ? previous.completedHotspots
          : [...previous.completedHotspots, "dorm"],
        log: ["你穿过消失的两道门，带着论坛日记逃出了白沙宿舍。", ...previous.log].slice(0, 6),
      }));
      window.setTimeout(() => {
        setActiveSceneId(null);
        placePlayerAtInteriorExit("dorm-baisha");
        closeInterior();
        setPhaserReady(true);
      }, 720);
      window.setTimeout(() => setExitBlackout(false), 1380);
      return;
    }
    const nextOutdoorSceneId = resolveInteriorExitTrigger(storyState);
    if (!nextOutdoorSceneId) return;
    // The next outdoor scene remains the map objective in storyState. Leaving
    // the glass door must first return control to the 2.5D campus; its story
    // popup opens only when the player reaches that outdoor hotspot.
    setExitBlackout(true);
    window.setTimeout(() => {
      setActiveSceneId(null);
      if (!placePlayerAtInteriorExit(interiorBuilding?.id) && storyState.currentSceneId === "library_police") {
        setPlayerIso({ x: 19.4, y: 30.2 });
      }
      closeInterior();
      setPhaserReady(true);
    }, 460);
    window.setTimeout(() => setExitBlackout(false), 980);
  }, [closeInterior, interiorBuilding?.id, placePlayerAtInteriorExit, setPlayerIso, setActiveSceneId, setStoryState, storyState]);

  // Story interiors cannot be abandoned through the top-right button.  The
  // active red exit performs the atomic "leave + show outdoor scene" step.
  const canExitInterior = Boolean(resolveInteriorExitTrigger(storyState));

  const startGame = useCallback(() => {
    if (BAISHA_CHASE_ONLY) {
      setLaunchMode(null);
      setLaunchAssetState("loading");
      setStoryState(() => createBaishaDevelopmentStoryState(true));
      startSession({ id: "dorm-baisha", name: "白沙宿舍", zone: "story" });
      setPhaserReady(false);
      return;
    }
    if (BAISHA_DEVELOPMENT_START) {
      setLaunchMode(null);
      setLaunchAssetState("loading");
      setStoryState(() => createBaishaDevelopmentStoryState());
      startSession({ id: "medical-library", name: "农医馆", zone: "story" });
      closeInterior();
      setPlayerIso({ ...BAISHA_DEVELOPMENT_PLAYER });
      setPhaserReady(true);
      return;
    }
    setPhaserReady(false); // 不加载 2.5D 地图，直接进入 3D 内景
    setLaunchAssetState("loading");
    setAssetLoadAttempt((value) => value + 1);
    setLaunchMode(scene01Debug ? null : "intro");
    // 使用 storyEngine 统一解析起始建筑（始终从第一个热点开始）
    const startBuilding = resolveGameStartBuilding();
    startSession(startBuilding ?? { id: "medical-library", name: "农医馆", zone: "story" });
  }, [closeInterior, scene01Debug, setPlayerIso, setStoryState, startSession]);

  const restartGame = useCallback(() => {
    resetAll();
    JumpscarePipeline.reset();
    setHud(initialHud);
    setLaunchAssetState("loading");
    setAssetLoadAttempt((value) => value + 1);
    setPhaserReady(false);
    setLaunchMode("restart");
    const startBuilding = resolveGameStartBuilding();
    startSession(startBuilding ?? { id: "medical-library", name: "农医馆", zone: "story" });
    miniMapSnapshotRef.current = { player: { x: 19.4, y: 30.2 }, ghostVisible: false };
    resetAudio();
    setGameSessionId((value) => value + 1);
  }, [resetAll, resetAudio, startSession]);

  const handleLaunchEnter = useCallback(() => {
    setLaunchMode(null);
    triggerEffect("reveal");
  }, [triggerEffect]);

  const handleLaunchRetry = useCallback(() => {
    setLaunchAssetState("loading");
    setAssetLoadAttempt((value) => value + 1);
  }, []);

  const dismissDocument = useCallback(() => {
    if (!documentView) return;
    setDocumentView(null);
    if (useGameStore.getState().storyState.currentSceneId === "library_receipt") {
      setActiveSceneId("library_receipt");
    }
  }, [documentView, setActiveSceneId]);

  useEffect(() => {
    if (!documentView) return;
    const dismiss = (event: KeyboardEvent) => {
      event.preventDefault();
      dismissDocument();
    };
    window.addEventListener("keydown", dismiss, { once: true });
    return () => window.removeEventListener("keydown", dismiss);
  }, [dismissDocument, documentView]);

  const reviveGame = useCallback(() => {
    const state = useGameStore.getState();
    if (state.interiorBuilding?.id === "dorm-baisha" && state.storyState.flags.baishaCaptured) {
      if (!reviveInterior()) return;
      JumpscarePipeline.reset();
      triggerEffect("reveal");
      window.dispatchEvent(new CustomEvent("zju-horror-baisha-revive"));
      return;
    }
    const deathPoint = { ...useGameStore.getState().playerIso };
    if (!revive()) return;
    JumpscarePipeline.reset();
    triggerEffect("reveal");
    window.dispatchEvent(new CustomEvent("zju-horror-player-revive", {
      detail: { playerIso: deathPoint, sanity: REVIVE_SANITY },
    }));
  }, [revive, reviveInterior, triggerEffect]);

  useEffect(() => {
    const handleBaishaCapture = (): void => {
      const state = useGameStore.getState();
      if (state.storyState.flags.baishaCaptured || state.world === "dead") return;
      playGhostHit();
      setNextObjectiveCue(null);
      setStoryState((previous) => ({
        ...previous,
        currentSceneId: "death_sanity",
        stats: { ...previous.stats, sanity: 0 },
        flags: { ...previous.flags, baishaCaptured: true },
        log: ["瘦长鬼影从红光里扣住了你。白沙的走廊重新合拢。", ...previous.log].slice(0, 6),
      }));
      // Put the death state and choice modal in place immediately, behind the
      // running jumpscare. When the scare clears there is no frozen gap and no
      // timer that can be cancelled by an intervening React lifecycle change.
      setWorld("dead");
      setActiveSceneId("death_sanity");
    };
    window.addEventListener("zju-horror-baisha-capture", handleBaishaCapture);
    return () => {
      window.removeEventListener("zju-horror-baisha-capture", handleBaishaCapture);
    };
  }, [playGhostHit, setActiveSceneId, setNextObjectiveCue, setStoryState, setWorld]);

  useEffect(() => {
    const handleGhostHit = (event: Event) => {
      const detail = (event as CustomEvent<{ type: "sanity" | "death"; amount?: number; playerIso?: IsoPoint }>).detail;
      if (detail.playerIso) setPlayerIso({ ...detail.playerIso });

      // 使用 storyEngine 的统一鬼伤害管道（护身符格挡、日志、死亡判断全部统一）
      setStoryState((previous) => {
        const result = applyGhostDamage(previous, detail.type === "death" ? -100 : (detail.amount ?? -6));

        if (result.dead) {
          setWorld("dead");
          setNextObjectiveCue(null);
          setActiveSceneId("death_sanity");
          playGhostHit();
          triggerEffect("jumpscare", "ghost_caught");
        } else {
          playGhostHit();
          triggerEffect("jumpscare", result.talismanBlocked ? "ghost_close" : "ghost_close");
          // 红鬼的致命碰撞若被护身符挡住，Phaser 侧仍需解除碰撞锁并把鬼移走。
          if (detail.type === "death" && result.talismanBlocked) {
            const survivedAt = detail.playerIso ?? useGameStore.getState().playerIso;
            window.setTimeout(() => {
              window.dispatchEvent(new CustomEvent("zju-horror-player-revive", {
                detail: { playerIso: { ...survivedAt }, sanity: result.nextState.stats.sanity },
              }));
            }, 0);
          }
        }

        return result.nextState;
      });
    };

    window.addEventListener("zju-horror-ghost-hit", handleGhostHit);
    return () => window.removeEventListener("zju-horror-ghost-hit", handleGhostHit);
  }, [playGhostHit, setPlayerIso, setWorld, triggerEffect]);

  // ── Jumpscare pipeline listener ──
  useEffect(() => {
    const handleJumpscare = (event: Event) => {
      const detail = (event as CustomEvent<{
        context: string; intensity: number;
        sanityCost: number; duration?: number; customMessage?: string; spriteId?: JumpscareSpriteId;
      }>).detail;
      const requestId = ++jumpscareRequestRef.current;
      const visualReady = detail.spriteId
        ? prepareJumpscareSprite(detail.spriteId)
        : Promise.resolve(true);

      void Promise.all([visualReady, audioManager.prepareJumpscare()]).then(([spriteReady]) => {
        if (requestId !== jumpscareRequestRef.current) return;
        triggerEffect(
          "jumpscare",
          detail.context as JumpscareContext,
          spriteReady ? detail.spriteId : undefined,
          detail.customMessage,
          detail.duration,
        );
      });
    };
    const handleSanityHit = (event: Event) => {
      const detail = (event as CustomEvent<{ amount: number; source: string }>).detail;
      if (detail.source === "jumpscare") {
        setStoryState((previous) => {
          const result = applyGhostDamage(previous, detail.amount);
          if (result.dead) {
            setWorld("dead");
            setNextObjectiveCue(null);
            setActiveSceneId("death_sanity");
          }
          return result.nextState;
        });
      }
    };

    window.addEventListener("zju-horror-jumpscare", handleJumpscare);
    window.addEventListener("zju-horror-sanity-hit", handleSanityHit);
    return () => {
      jumpscareRequestRef.current += 1;
      window.removeEventListener("zju-horror-jumpscare", handleJumpscare);
      window.removeEventListener("zju-horror-sanity-hit", handleSanityHit);
    };
  }, [setWorld, triggerEffect]);

  const useInventoryItem = useCallback(
    (itemId: ItemId) => {
      if (itemId !== "medicine" && itemId !== "energy") return;
      playItem();
      let used = false;
      setStoryState((previous) => {
        const result = useStoryInventoryItem(previous, itemId);
        used = result.used;
        return result.nextState;
      });
      if (!used) return;
      triggerEffect("reveal");
    },
    [playItem, triggerEffect],
  );

  const commitChoice = useCallback(
    (choice: StoryChoice) => {
      if (!activeScene || isChoiceLocked(choice, storyState)) return;

      const transition = advanceStory(storyState, activeScene, choice);
      if (!transition) return;
      const { nextState, nextScene, nextHotspot, changesLocation, effect } = transition;
      const inInterior = Boolean(interiorBuilding);

      // The first chapter is complete once the police sequence starts. Use
      // that reading/transition time to download Baisha's authored GLBs. The
      // loader reuses these exact ArrayBuffers on entry, so this does not make
      // a second request and it deliberately postpones CPU/GPU parsing until
      // the player actually enters the dorm.
      if (nextScene.id === "library_police" || nextScene.id === "dorm_baiqiu") {
        void preloadInteriorAsset({
          buildingId: "dorm-baisha",
          roomKind: "dorm",
          isMobile,
        }).catch((error) => {
          console.warn("[App] Baisha background preload was unavailable; entry will retry.", error);
        });
      }

      setStoryState(() => nextState);
      triggerNarrativeEffect(effect, contextForHotspot(nextScene.locationId));
      if (activeScene.id === "library_shelf") {
        window.setTimeout(() => {
          const text = pickJumpscareText("library_shelf", useGameStore.getState().storyState.stats.sanity);
          JumpscarePipeline.executeStoryEffect("library_shelf", 0.88, text, "library-shelf");
        }, 920);
      }

      const commands = resolvePostChoiceCommands({ activeScene, nextScene, nextHotspot, changesLocation, inInterior });
      for (const command of commands) {
        if (command.kind === "exit-interior") {
          // Clear the in-room modal before mounting Phaser.  A stale modal
          // used to leave the newly-created map frozen at the library door.
          setActiveSceneId(null);
          if (!placePlayerAtInteriorExit(interiorBuilding?.id) && activeScene.locationId === "library") {
            setPlayerIso({ x: 19.4, y: 30.2 });
          }
          closeInterior();
          setPhaserReady(true);
        } else if (command.kind === "enter-building") {
          const building = getStoryBuildingForHotspot(command.hotspotId);
          if (building) openInterior(building);
        } else if (command.kind === "show-objective") {
          setNextObjectiveCue({ place: command.place, objective: command.objective });
        } else if (command.kind === "set-active-scene") {
          setNextObjectiveCue(null);
          setActiveSceneId(command.sceneId);
        }
      }

    },
    [activeScene, closeInterior, interiorBuilding, isMobile, openInterior, placePlayerAtInteriorExit, setActiveSceneId, setPlayerIso, storyState, triggerNarrativeEffect],
  );

  const choose = useCallback((choice: StoryChoice) => {
    if (selectedChoiceId || pendingChoiceResult || !activeScene || isChoiceLocked(choice, storyState)) return;
    playChoice();
    setSelectedChoiceId(choice.id);
    window.setTimeout(() => setStoryClosing(true), 210);
    if (choiceTimerRef.current !== null) window.clearTimeout(choiceTimerRef.current);
    choiceTimerRef.current = window.setTimeout(() => {
      choiceTimerRef.current = null;
      if (choice.result) {
        setPendingResultOption(null);
        setPendingChoiceResult(choice);
      } else {
        commitChoice(choice);
      }
      setSelectedChoiceId(null);
      setStoryClosing(false);
    }, 680);
  }, [activeScene, commitChoice, pendingChoiceResult, playChoice, selectedChoiceId, storyState]);

  const chooseResultOption = useCallback((option: StoryResultOption) => {
    if (!pendingChoiceResult || pendingResultOption || selectedChoiceId) return;
    playChoice();
    setSelectedChoiceId(option.id);
    window.setTimeout(() => setStoryClosing(true), 210);
    if (choiceTimerRef.current !== null) window.clearTimeout(choiceTimerRef.current);
    choiceTimerRef.current = window.setTimeout(() => {
      choiceTimerRef.current = null;
      setPendingResultOption(option);
      setSelectedChoiceId(null);
      setStoryClosing(false);
    }, 680);
  }, [pendingChoiceResult, pendingResultOption, playChoice, selectedChoiceId]);

  const continueChoiceResult = useCallback(() => {
    if (!pendingChoiceResult || selectedChoiceId) return;
    if (pendingChoiceResult.result?.choices?.length && !pendingResultOption) return;
    const choice = pendingChoiceResult;
    playChoice();
    setSelectedChoiceId(choice.id);
    window.setTimeout(() => setStoryClosing(true), 210);
    if (choiceTimerRef.current !== null) window.clearTimeout(choiceTimerRef.current);
    choiceTimerRef.current = window.setTimeout(() => {
      choiceTimerRef.current = null;
      setPendingChoiceResult(null);
      setPendingResultOption(null);
      commitChoice(choice);
      setSelectedChoiceId(null);
      setStoryClosing(false);
    }, 680);
  }, [commitChoice, pendingChoiceResult, pendingResultOption, playChoice, selectedChoiceId]);

  useEffect(() => () => {
    if (choiceTimerRef.current !== null) window.clearTimeout(choiceTimerRef.current);
  }, []);

  const usableItems = useMemo<Set<ItemId>>(
    () => new Set(storyState.inventory.filter((id) => id === "medicine" || id === "energy")),
    [storyState.inventory],
  );

  const rootClass = ["appShell", !gameStarted ? "titleMode" : "", screenEffect ? `fx-${screenEffect}` : ""].filter(Boolean).join(" ");
  const isBaishaInterior = interiorBuilding?.id === "dorm-baisha";
  const isBaishaEntryStory = Boolean(isBaishaInterior && activeScene?.locationId === "dorm" && activeScene.setting === "outdoor");
  const baishaStillLoading = Boolean(isBaishaInterior && launchAssetState === "loading");
  const completedCount = storyState.completedHotspots.length;
  const talismanShield = storyState.inventory.includes("talisman") ? 1 : 0;
  const isBaishaDeath = Boolean(storyState.flags.baishaCaptured);
  const isBaishaDeathScene = Boolean(isBaishaDeath && activeScene?.id === "death_sanity");
  const displayedChoiceResult = pendingResultOption ?? pendingChoiceResult?.result;
  const activeSceneTitle = isBaishaDeathScene
    ? "逃离失败"
    : displayedChoiceResult?.title ?? activeScene?.title;
  const activeScenePlace = isBaishaDeathScene
    ? "白沙宿舍"
    : activeScene
      ? getHotspotById(activeScene.locationId)?.place
      : undefined;
  const activeSceneBody = isBaishaDeathScene
    ? [
        "瘦长的影子在走廊转角追上了你。红灯一盏盏沉进黑暗，最后只剩那阵贴近耳后的呼吸声。",
        "意识散去以前，你记得那条被白痕封住的捷径，也记得真正的出口仍在走廊另一侧。",
      ]
    : displayedChoiceResult?.body ?? activeScene?.body ?? [];
  const activeSceneHighlights = isBaishaDeathScene
    ? []
    : displayedChoiceResult?.highlights ?? activeScene?.highlights ?? [];
  const activeStoryLineCount = activeSceneBody.length + activeSceneHighlights.length;
  const canReviveDeath = revivesRemaining > 0 || (isBaishaDeath && talismanShield > 0);
  const livesAvailable = revivesRemaining + (world === "dead" ? 0 : 1) + talismanShield;
  const maxLives = INITIAL_REVIVES + 1 + talismanShield;
  const storyLayer = activeScene ? (
    <>
      <div
        className={`storyGlassBackdrop ${activeScene.strongBlur ? "strong" : ""} ${isBaishaEntryStory ? "baishaEntry" : ""} ${storyClosing ? "closing" : ""}`}
        style={interiorBuilding ? { zIndex: 4999 } : undefined}
        aria-hidden="true"
      />
      <section
        className={`${activeScene.ending ? "storyModal ending" : "storyModal"} ${storyClosing ? "closing" : ""}`}
        style={interiorBuilding ? { zIndex: 5000 } : undefined}
        aria-live="polite"
      >
        <div className="storyKicker">
          <span>{activeScene.chapter}</span>
          <b>{activeScenePlace}</b>
        </div>
        <h1>{activeSceneTitle}</h1>
        <div className="storyText">
          {activeSceneBody.map((paragraph, index) => (
            <p
              className={storyTone(paragraph)}
              data-text={paragraph}
              key={paragraph}
              style={{ "--story-line-delay": `${180 + index * 260}ms` } as CSSProperties}
            >
              {paragraph}
            </p>
          ))}
          {activeSceneHighlights.map((paragraph, index) => (
            <p
              className="storyHighlight"
              data-text={paragraph}
              key={`${paragraph}-${index}`}
              style={{ "--story-line-delay": `${180 + (activeSceneBody.length + index) * 260}ms` } as CSSProperties}
            >
              {paragraph}
            </p>
          ))}
        </div>
        {activeScene.ending ? (
          <div className="endingActions">
            {activeScene.id === "death_sanity" && canReviveDeath && (
              <button className="choiceButton primary reviveButton" onClick={reviveGame} type="button">
                <span>复活</span>
                <em>{isBaishaDeath && talismanShield > 0 ? "消耗 1 张符纸" : `消耗 1 次复活 · 当前剩余 ${revivesRemaining}`}</em>
              </button>
            )}
            <button
              className={activeScene.id === "death_sanity" && canReviveDeath ? "choiceButton restartButton" : "choiceButton primary"}
              onClick={restartGame}
              type="button"
            >
              重新开始游戏
            </button>
          </div>
        ) : pendingChoiceResult?.result ? (
          <div
            className="choiceList"
            style={{ "--choice-list-delay": `${260 + activeStoryLineCount * 260}ms` } as CSSProperties}
          >
            {pendingChoiceResult.result.choices?.length && !pendingResultOption ? (
              pendingChoiceResult.result.choices.map((option, optionIndex) => (
                <button
                  className={`choiceButton ${selectedChoiceId === option.id ? "selected" : ""}`}
                  disabled={selectedChoiceId !== null}
                  key={option.id}
                  style={{ "--choice-delay": `${optionIndex * 100}ms` } as CSSProperties}
                  onClick={() => chooseResultOption(option)}
                  onFocus={playHover}
                  onMouseEnter={playHover}
                  type="button"
                >
                  <span>{option.text}</span>
                </button>
              ))
            ) : (
              <button
                className={`choiceButton primary ${selectedChoiceId === pendingChoiceResult.id ? "selected" : ""}`}
                disabled={selectedChoiceId !== null}
                onClick={continueChoiceResult}
                onFocus={playHover}
                onMouseEnter={playHover}
                type="button"
              >
                <span>{pendingResultOption?.continueText ?? pendingChoiceResult.result.continueText ?? "继续"}</span>
              </button>
            )}
          </div>
        ) : (
          <div
            className="choiceList"
            style={{ "--choice-list-delay": `${260 + activeSceneBody.length * 260}ms` } as CSSProperties}
          >
            {activeScene.choices.map((choice, choiceIndex) => {
              const locked = isChoiceLocked(choice, storyState);
              const delta = statDeltaText(choice.statChanges);
              const required = choice.requireItem ? `需要：${itemCatalog[choice.requireItem].name}` : "";
              return (
                <button
                  className={`${locked ? "choiceButton locked" : "choiceButton"} ${selectedChoiceId === choice.id ? "selected" : ""}`}
                  disabled={locked || selectedChoiceId !== null}
                  key={choice.id}
                  style={{ "--choice-delay": `${choiceIndex * 100}ms` } as CSSProperties}
                  onClick={() => choose(choice)}
                  onFocus={() => !locked && playHover()}
                  onMouseEnter={() => !locked && playHover()}
                >
                  <span>{choice.text}</span>
                  {(delta || required) && <em>{locked ? required : delta}</em>}
                </button>
              );
            })}
          </div>
        )}
      </section>
    </>
  ) : null;

  return (
    <main className={rootClass}>
      <aside className="leftRail" aria-label="游戏状态与任务">
        <header className="gameBrand">
          <RadioTower size={18} />
          <div>
            <strong>浙大夜惊魂</strong>
            <span>00:47 / 紫金港校区</span>
          </div>
        </header>

        <section className="railSection lifeStrip" aria-label={`剩余生命 ${livesAvailable}`}>
          <div>
            <span>生命</span>
            <b>{livesAvailable}/{maxLives}</b>
          </div>
          <div className="lifeHearts" aria-hidden="true">
            {Array.from({ length: maxLives }, (_, index) => (
              <Heart key={index} size={18} fill={index < livesAvailable ? "currentColor" : "none"} />
            ))}
          </div>
        </section>

        <section className="railSection statusGrid" aria-label="状态">
          {(Object.entries(storyState.stats) as Array<[StatKey, number]>)
            .filter(([key]) => statMeta[key])
            .map(([key, value]) => {
            const meta = statMeta[key];
            const Icon = meta.icon;
            const danger = meta.dangerBelow !== undefined && value <= meta.dangerBelow;
            return (
              <div className={danger ? "statTile danger" : "statTile"} key={key}>
                <div className="statLabel">
                  <Icon size={16} />
                  <span>{meta.label}</span>
                  <b>{value}</b>
                </div>
                <div className="statTrack">
                  <span style={{ width: `${value}%` }} />
                </div>
              </div>
            );
          })}
        </section>

        <section className="railSection">
          <div className="sectionTitle">
            <MapPin size={16} />
            <span>当前引导</span>
          </div>
          <div className="objective">
            <strong>{targetHotspot?.place ?? currentScene.title}</strong>
            <span>{targetHotspot?.objective ?? "继续调查"}</span>
            <em>{hud.prompt || "WASD / 方向键移动，沿红色虚线路线前进，绕开红鬼"}</em>
          </div>
        </section>

        <section className="railSection taskColumn" aria-label="任务链">
          <div className="sectionTitle">
            <Sparkles size={16} />
            <span>地点链</span>
            <b>
              {completedCount}/{storyHotspots.length}
            </b>
          </div>
          {storyHotspots.map((hotspot) => {
            const done = storyState.completedHotspots.includes(hotspot.id);
            const current = hotspot.id === targetHotspotId;
            const visited = storyState.visitedHotspots.includes(hotspot.id);
            return (
              <div className={["task", done ? "done" : "", current ? "current" : "", visited ? "visited" : ""].join(" ")} key={hotspot.id}>
                {done ? <BadgeCheck size={17} /> : <CircleDot size={17} />}
                <div>
                  <strong>{hotspot.title}</strong>
                  <span>{hotspot.place}</span>
                </div>
              </div>
            );
          })}
        </section>

        <section className="railSection">
          <div className="sectionTitle">
            <Backpack size={16} />
            <span>道具</span>
          </div>
          <div className="inventoryList">
            {storyState.inventory.length ? (
              storyState.inventory.map((itemId) => {
                const item = itemCatalog[itemId];
                const usable = usableItems.has(itemId);
                return (
                  <button className={usable ? "inventoryItem usable" : "inventoryItem"} key={itemId} onClick={() => useInventoryItem(itemId)}>
                    <b>{item.icon}</b>
                    <span>{item.name}</span>
                  </button>
                );
              })
            ) : (
              <p className="emptyText">还没有可以依赖的东西。</p>
            )}
          </div>
        </section>

        <section className="railSection logList">
          <div className="sectionTitle">
            <HeartPulse size={16} />
            <span>调查记录</span>
          </div>
          {storyState.log.map((line, index) => (
            <p key={`${line}-${index}`}>{line}</p>
          ))}
        </section>
      </aside>

      <section className="gameFrame" aria-label="浙大夜惊魂地图">
        <div ref={containerRef} className="gameCanvas" />
        <canvas ref={particleCanvasRef} className="particleCanvas" aria-hidden="true" />
        <canvas ref={miniMapCanvasRef} className="miniMapCanvas" aria-label="campus minimap" />
        <div className="vignette" />
        <div className="scanline" />
        <div className="chromaticVeil" />
        <div className={screenEffect === "low-sanity" ? "bloomVeil active" : "bloomVeil"} />
        <div className={screenEffect === "low-sanity" ? "sanityEdgePulse active" : "sanityEdgePulse"} />
        <div className="lensDirt" />
        <div className={screenEffect === "jumpscare" ? "jumpscareOverlay active" : "jumpscareOverlay"} />
        {JUMPSCARE_SPRITE_IDS.map((spriteId) => (
          <img
            key={spriteId}
            className={`jumpscareSprite jumpscareSprite--${spriteId} ${jumpscareSprite === spriteId && screenEffect === "jumpscare" ? "active" : ""}`}
            src={jumpscareSpriteUrl(spriteId)}
            alt=""
            aria-hidden="true"
          />
        ))}
        {!jumpscareSprite ? (
          <div className={screenEffect === "jumpscare" ? "jumpscareFace active" : "jumpscareFace"} aria-hidden="true">
            <span className="faceEye left" />
            <span className="faceEye right" />
            <span className="faceMouth" />
          </div>
        ) : null}
        <div className={screenEffect === "jumpscare" ? "bloodDripOverlay active" : "bloodDripOverlay"} aria-hidden="true">
          <i /><i /><i /><i /><i />
        </div>
        <div className={["jumpscareText", screenEffect === "jumpscare" ? "active" : "", jumpscareVariant].join(" ")}>{jumpscareText}</div>

        {nextObjectiveCue && !activeScene && (
          <div className="routeCue" role="status">
            <span>下一段</span>
            <strong>{nextObjectiveCue.place}</strong>
            <em>{nextObjectiveCue.objective}</em>
          </div>
        )}

        {gameStarted && nearBuilding && !activeScene && !interiorBuilding && (
          <button className="enterBuildingBtn" onClick={enterNearBuilding} type="button">
            <span>进入 {nearBuilding.name}</span>
            <em>{isMobile ? "点击进入内部" : "按 E 或点击进入"}</em>
          </button>
        )}

        {/* 摇杆对所有设备可见:桌面可用鼠标拖动移动(键盘焦点/占用异常时的兜底),移动端为主控。 */}
        {gameStarted && !activeScene && !interiorBuilding && <MapJoystick onMove={handleJoystick} />}

        {documentView && (
          <section
            className="documentReading"
            style={interiorBuilding ? { zIndex: 2010 } : undefined}
            onClick={dismissDocument}
            role="button"
            tabIndex={0}
            aria-label="借阅小票内容，按任意键继续"
          >
            <div className="documentReading__paper">
              <span>农医馆 / 借阅终端</span>
              <h1>{documentView.title}</h1>
              {documentView.lines.map((line, index) => (
                <p
                  key={`${line}-${index}`}
                  style={{ "--document-line-delay": `${160 + index * 260}ms` } as CSSProperties}
                >
                  {line}
                </p>
              ))}
              <em>点击或按任意键继续</em>
            </div>
          </section>
        )}

        {!interiorBuilding && storyLayer}
      </section>

      {!gameStarted && (
        <section className="titleScreen" aria-label="浙大夜惊魂开场界面">
          <div className="titleAtmosphere" aria-hidden="true" />
          <div className="titlePanel">
            <p className="titleEyebrow">紫金港校区 / 00:47</p>
            <h1>浙大夜惊魂</h1>
            <p className="titleSubtitle">学长学姐代代相传的校园恐怖传说</p>
            <p className="titleWarning">游戏包含恐怖元素，请谨慎游玩</p>
            <button className="titleStartButton" onClick={startGame} onMouseEnter={playHover} type="button">
              开始游戏
            </button>
            <p className="titleMeta">二维地图推理 · 多分支剧情 · 道具系统 · 理智管理</p>
          </div>
        </section>
      )}


      {interiorBuilding && (
        <InteriorOverlay
          key={`${interiorBuilding.id}:${assetLoadAttempt}`}
          building={interiorBuilding}
          currentSceneId={storyState.currentSceneId}
          inventory={storyState.inventory}
          isMobile={isMobile}
          onExit={leaveInteriorFromTrigger}
          onExitTrigger={leaveInteriorFromTrigger}
          canExit={canExitInterior}
          blockUntilAssetReady={launchMode !== null || baishaStillLoading}
          onAssetStateChange={setLaunchAssetState}
        />
      )}

      {interiorBuilding && storyLayer ? createPortal(storyLayer, document.body) : null}

      {isBaishaInterior && (
        <div
          className={`baishaLoadCurtain ${isBaishaEntryStory || baishaStillLoading ? "active" : ""}`}
          aria-hidden="true"
        >
          {!activeScene && baishaStillLoading ? <span>白沙宿舍 / 正在适应黑暗</span> : null}
        </div>
      )}

      {/* Interior3D is its own high stacking layer. Mirror the central scare
          state above it so story-driven sprites can never be hidden behind
          the WebGL overlay. */}
      {interiorBuilding && (
        <div className="interiorScareLayer" aria-hidden="true">
          <div className={screenEffect === "jumpscare" ? "jumpscareOverlay active" : "jumpscareOverlay"} />
          {JUMPSCARE_SPRITE_IDS.map((spriteId) => (
            <img
              key={spriteId}
              className={`jumpscareSprite jumpscareSprite--${spriteId} ${jumpscareSprite === spriteId && screenEffect === "jumpscare" ? "active" : ""}`}
              src={jumpscareSpriteUrl(spriteId)}
              alt=""
            />
          ))}
          <div className={screenEffect === "jumpscare" ? "bloodDripOverlay active" : "bloodDripOverlay"}>
            <i /><i /><i /><i /><i />
          </div>
          <div className={["jumpscareText", screenEffect === "jumpscare" ? "active" : "", jumpscareVariant].join(" ")}>
            {jumpscareText}
          </div>
        </div>
      )}

      <div className={exitBlackout ? "exitBlackout active" : "exitBlackout"} aria-hidden="true" />

      {launchMode ? (
        <LaunchSequence
          mode={launchMode}
          assetState={launchAssetState}
          isMobile={isMobile}
          onEnter={handleLaunchEnter}
          onRetry={handleLaunchRetry}
        />
      ) : null}
    </main>
  );
}

export default App;
