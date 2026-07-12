import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type StorySceneId,
} from "./game/storyData";
import { useGameAudio } from "./game/audio/useGameAudio";
import { useGameStore } from "./game/store";
import { pickJumpscareText, contextForHotspot, textVariantClass, type JumpscareContext } from "./game/jumpscareTexts";
import { JumpscarePipeline } from "./game/JumpscarePipeline";
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

  const onDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    pointerId.current = e.pointerId;
    const rect = e.currentTarget.getBoundingClientRect();
    origin.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

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
      pointerId.current = null;
      if (knobRef.current) knobRef.current.style.transform = "translate(0px, 0px)";
      onMove(0, 0);
    },
    [onMove],
  );

  return (
    <div
      className="touchJoystick"
      onPointerDown={onDown}
      onPointerMove={onMovePointer}
      onPointerUp={onUp}
      onPointerCancel={onUp}
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
  const gameRef = useRef<Phaser.Game | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const particleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const miniMapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const miniMapSnapshotRef = useRef<MiniMapSnapshot>({ player: { x: 19.4, y: 30.2 }, ghostVisible: false });
  const miniMapFrameRef = useRef<number | null>(null);
  const [hud, setHud] = useState<GameHudEvent>(initialHud);
  const [gameSessionId, setGameSessionId] = useState(0);
  const [phaserReady, setPhaserReady] = useState(false);
  const isMobile = useIsMobile();

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
  const interiorBuilding = useGameStore((s) => s.interiorBuilding);
  const nearBuilding = useGameStore((s) => s.nearBuilding);
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
    (effect?: HorrorEffect, context?: JumpscareContext) => {
      if (!effect) return;
      setScreenEffect(effect);
      playEffect(effect);
      if (effect === "jumpscare" || effect === "shake") {
        const ctx = context ?? contextForHotspot(targetHotspotId);
        const text = pickJumpscareText(ctx, storyState.stats.sanity);
        useGameStore.getState().setJumpscareText(text);
      }
      window.dispatchEvent(new CustomEvent("zju-horror-effect", { detail: { effect } }));
      window.setTimeout(() => setScreenEffect(""), effect === "jumpscare" ? 760 : 520);
    },
    [playEffect, storyState.stats.sanity, targetHotspotId],
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
    if (!canvas) return;

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
  }, [gameSessionId]);

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

      setStoryState((previous) => visitStoryHotspot(previous, scene));
      setActiveSceneId(sceneId);
      // 统一走 triggerEffect：音频 + CSS 叠加层 + 惊吓文字 + 相机抖动全部到位
      triggerNarrativeEffect(scene.effect, contextForHotspot(scene.locationId));
    };

    window.addEventListener("zju-horror-open-story", handleOpenStory);
    return () => {
      window.removeEventListener("zju-horror-open-story", handleOpenStory);
    };
  }, [currentScene.locationId, playEffect, storyState.currentSceneId, triggerNarrativeEffect]);

  // 3D 内景中的故事触发区 → 弹出文字弹窗（覆盖在 3D 画面上）
  useEffect(() => {
    const handleInteriorStory = (event: Event) => {
      const { sceneId } = (event as CustomEvent<{ sceneId: string }>).detail;
      const sid = sceneId as StorySceneId;
      if (!storyScenes[sid]) return;
      const scene = storyScenes[sid];
      setStoryState((previous) => visitStoryHotspot(previous, scene));
      setActiveSceneId(sid);
      // 统一走 triggerEffect：音频 + CSS 叠加层 + 惊吓文字 + 相机抖动全部到位
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
  }, [interiorBuilding]);

  // 内景里拾取的道具加入剧情物品栏(去重),对后续文字剧情选项有用。
  useEffect(() => {
    const onPickup = (event: Event) => {
      const { itemId, name } = (event as CustomEvent<{ itemId: string; name: string }>).detail;
      setStoryState((prev) => collectStoryItem(prev, itemId, name).nextState);
    };
    window.addEventListener("zju-horror-pickup", onPickup);
    return () => window.removeEventListener("zju-horror-pickup", onPickup);
  }, []);

  // 虚拟摇杆把移动向量注入到 Phaser 的 CampusScene。
  const handleJoystick = useCallback((x: number, y: number) => {
    const scene = gameRef.current?.scene?.getScene("CampusScene") as CampusScene | undefined;
    scene?.setTouchInput?.(x, y);
  }, []);

  const enterNearBuilding = useCallback(() => {
    if (nearBuilding) openInterior(nearBuilding);
  }, [nearBuilding, openInterior]);

  const leaveInterior = useCallback(() => {
    closeInterior();
    setPhaserReady(true);
  }, [closeInterior]);

  const leaveInteriorFromTrigger = useCallback(() => {
    const nextActiveSceneId = resolveInteriorExitTrigger(storyState);
    // Make the pending outdoor scene visible before mounting Phaser.  This
    // prevents a newly-created map from immediately retargeting the player
    // back into the library to discover the same scene again.
    if (nextActiveSceneId) setActiveSceneId(nextActiveSceneId);
    if (storyState.currentSceneId === "library_police") {
      setPlayerIso({ x: 19.4, y: 30.2 });
    }
    closeInterior();
    setPhaserReady(true);
  }, [closeInterior, setPlayerIso, setActiveSceneId, storyState]);

  const finishBaishaEscape = useCallback(() => {
    const next = storyScenes.find_yicheng;
    setStoryState((previous) => ({
      ...previous,
      currentSceneId: "find_yicheng",
      visitedHotspots: previous.visitedHotspots.includes("dorm") ? previous.visitedHotspots : [...previous.visitedHotspots, "dorm"],
      completedHotspots: previous.completedHotspots.includes("dorm") ? previous.completedHotspots : [...previous.completedHotspots, "dorm"],
      log: [...previous.log, "逃离白沙宿舍后，你带着苏婉的照片前往临湖餐厅。"],
    }));
    setPlayerIso({ x: 6.0, y: 7.5 });
    setNextObjectiveCue({ place: getHotspotById(next.locationId)?.place ?? "临湖餐厅", objective: "寻找张一诚，确认照片的来历" });
    closeInterior();
    setPhaserReady(true);
  }, [closeInterior, setPlayerIso, setStoryState]);

  const failBaishaEscape = useCallback(() => {
    setWorld("dead");
    setActiveSceneId("death_sanity");
    triggerNarrativeEffect("jumpscare", "dorm");
  }, [setActiveSceneId, setWorld, triggerNarrativeEffect]);

  // Story interiors cannot be abandoned through the top-right button.  The
  // active red exit performs the atomic "leave + show outdoor scene" step.
  const canExitInterior = Boolean(resolveInteriorExitTrigger(storyState));

  const startGame = useCallback(() => {
    setPhaserReady(false); // 不加载 2.5D 地图，直接进入 3D 内景
    triggerEffect("reveal");
    // 使用 storyEngine 统一解析起始建筑（始终从第一个热点开始）
    const startBuilding = resolveGameStartBuilding();
    startSession(startBuilding ?? { id: "medical-library", name: "医学分馆", zone: "story" });
  }, [startSession, triggerEffect]);

  const restartGame = useCallback(() => {
    setPhaserReady(false);
    resetAll();
    JumpscarePipeline.reset();
    setHud(initialHud);
    const startBuilding = resolveGameStartBuilding();
    startSession(startBuilding ?? { id: "medical-library", name: "医学分馆", zone: "story" });
    miniMapSnapshotRef.current = { player: { x: 19.4, y: 30.2 }, ghostVisible: false };
    resetAudio();
    setGameSessionId((value) => value + 1);
  }, [resetAll, resetAudio, startSession]);

  useEffect(() => {
    const handleGhostHit = (event: Event) => {
      const detail = (event as CustomEvent<{ type: "sanity" | "death"; amount?: number }>).detail;

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
        }

        return result.nextState;
      });
    };

    window.addEventListener("zju-horror-ghost-hit", handleGhostHit);
    return () => window.removeEventListener("zju-horror-ghost-hit", handleGhostHit);
  }, [playGhostHit, setWorld, triggerEffect]);

  // ── Jumpscare pipeline listener ──
  useEffect(() => {
    const handleJumpscare = (event: Event) => {
      const detail = (event as CustomEvent<{
        context: string; intensity: number;
        sanityCost: number; customMessage?: string;
      }>).detail;
      const text = detail.customMessage ?? pickJumpscareText(
        detail.context as JumpscareContext, storyState.stats.sanity,
      );
      useGameStore.getState().setJumpscareText(text);
      triggerEffect("jumpscare", detail.context as JumpscareContext);
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
      window.removeEventListener("zju-horror-jumpscare", handleJumpscare);
      window.removeEventListener("zju-horror-sanity-hit", handleSanityHit);
    };
  }, [setWorld, storyState.stats.sanity, triggerEffect]);

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

  const choose = useCallback(
    (choice: StoryChoice) => {
      if (!activeScene || isChoiceLocked(choice, storyState)) return;
      playChoice();

      const transition = advanceStory(storyState, activeScene, choice);
      if (!transition) return;
      const { nextState, nextScene, nextHotspot, changesLocation, effect } = transition;
      const inInterior = Boolean(interiorBuilding);

      setStoryState(() => nextState);
      triggerNarrativeEffect(effect, contextForHotspot(nextScene.locationId));

      const commands = resolvePostChoiceCommands({ activeScene, nextScene, nextHotspot, changesLocation, inInterior });
      for (const command of commands) {
        if (command.kind === "exit-interior") {
          // Clear the in-room modal before mounting Phaser.  A stale modal
          // used to leave the newly-created map frozen at the library door.
          setActiveSceneId(null);
          if (activeScene.locationId === "library") {
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
    [activeScene, closeInterior, interiorBuilding, openInterior, playChoice, setActiveSceneId, setPlayerIso, storyState, triggerNarrativeEffect],
  );

  const usableItems = useMemo<Set<ItemId>>(
    () => new Set(storyState.inventory.filter((id) => id === "medicine" || id === "energy")),
    [storyState.inventory],
  );

  const rootClass = ["appShell", !gameStarted ? "titleMode" : "", screenEffect ? `fx-${screenEffect}` : ""].filter(Boolean).join(" ");
  const completedCount = storyState.completedHotspots.length;

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
        <div className={screenEffect === "jumpscare" ? "jumpscareFace active" : "jumpscareFace"} aria-hidden="true">
          <span className="faceEye left" />
          <span className="faceEye right" />
          <span className="faceMouth" />
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

        {activeScene && (
          <section
            className={activeScene.ending ? "storyModal ending" : "storyModal"}
            style={interiorBuilding ? { zIndex: 2000 } : undefined}
            aria-live="polite"
          >
            <div className="storyKicker">
              <span>{activeScene.chapter}</span>
              <b>{getHotspotById(activeScene.locationId)?.place}</b>
            </div>
            <h1>{activeScene.title}</h1>
            <div className="storyText">
              {activeScene.body.map((paragraph) => (
                <p className={storyTone(paragraph)} key={paragraph}>
                  {paragraph}
                </p>
              ))}
            </div>
            {activeScene.ending ? (
              <button className="choiceButton primary" onClick={restartGame}>
                重新开始
              </button>
            ) : (
              <div className="choiceList">
                {activeScene.choices.map((choice) => {
                  const locked = isChoiceLocked(choice, storyState);
                  const delta = statDeltaText(choice.statChanges);
                  const required = choice.requireItem ? `需要：${itemCatalog[choice.requireItem].name}` : "";
                  return (
                    <button
                      className={locked ? "choiceButton locked" : "choiceButton"}
                      disabled={locked}
                      key={choice.id}
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
        )}
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
          building={interiorBuilding}
          currentSceneId={storyState.currentSceneId}
          inventory={storyState.inventory}
          isMobile={isMobile}
          onExit={leaveInteriorFromTrigger}
          onExitTrigger={leaveInteriorFromTrigger}
          canExit={canExitInterior}
          onLevelExit={finishBaishaEscape}
          onLevelDeath={failBaishaEscape}
        />
      )}
    </main>
  );
}

export default App;
