import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Phaser from "phaser";
import {
  Backpack,
  BadgeCheck,
  Brain,
  CircleDot,
  Footprints,
  HandHeart,
  HeartPulse,
  MapPin,
  RadioTower,
  Search,
  Sparkles,
} from "lucide-react";
import { CampusScene, type GameHudEvent, type GameMiniMapEvent } from "./game/CampusScene";
import { campusBuildings, campusRoads, type IsoPoint } from "./game/mapData";
import {
  clampStat,
  getHotspotById,
  getSceneHotspot,
  initialStoryState,
  itemCatalog,
  storyHotspots,
  storyScenes,
  type HorrorEffect,
  type HotspotId,
  type ItemId,
  type StatKey,
  type StoryChoice,
  type StorySceneId,
  type StoryState,
} from "./game/storyData";

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

type NextObjectiveCue = {
  place: string;
  objective: string;
};

function createStoryState(): StoryState {
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

const statMeta: Record<StatKey, { label: string; icon: typeof Brain; dangerBelow?: number }> = {
  sanity: { label: "理智", icon: Brain, dangerBelow: 30 },
  stamina: { label: "体力", icon: Footprints, dangerBelow: 25 },
  clues: { label: "线索", icon: Search },
  trust: { label: "信任", icon: HandHeart },
};

function uniqueValues<T extends string>(items: T[]) {
  return Array.from(new Set(items));
}

function appendLog(log: string[], line: string) {
  return [line, ...log].slice(0, 6);
}

function statDeltaText(changes?: Partial<Record<StatKey, number>>) {
  if (!changes) return "";
  return (Object.entries(changes) as Array<[StatKey, number]>)
    .filter(([, value]) => value !== 0)
    .map(([key, value]) => `${statMeta[key].label}${value > 0 ? "+" : ""}${value}`)
    .join(" / ");
}

function storyTone(paragraph: string) {
  if (/砰|血|死|刀|尖叫|抓|崩溃|绳子仍在收紧|贴到背后/.test(paragraph)) return "shock";
  if (/突然|黑暗|警告|不要|不该|恐惧|没有|空无一人|很轻|低声/.test(paragraph)) return "tense";
  return "";
}

function isChoiceLocked(choice: StoryChoice, state: StoryState) {
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

function useHorrorAudio() {
  const audioRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);

  const ensureAudio = useCallback(() => {
    if (audioRef.current) return audioRef.current;
    const AudioCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return null;
    const ctx = new AudioCtor();
    const gain = ctx.createGain();
    gain.gain.value = 0.018;
    gain.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 46;
    osc.connect(gain);
    osc.start();

    audioRef.current = ctx;
    gainRef.current = gain;
    return ctx;
  }, []);

  const playEffect = useCallback(
    (effect?: HorrorEffect) => {
      if (!effect) return;
      const ctx = ensureAudio();
      if (!ctx) return;
      const gain = ctx.createGain();
      const osc = ctx.createOscillator();
      const now = ctx.currentTime;

      osc.type = effect === "jumpscare" ? "square" : "sine";
      osc.frequency.setValueAtTime(effect === "jumpscare" ? 96 : effect === "reveal" ? 220 : 72, now);
      osc.frequency.exponentialRampToValueAtTime(effect === "jumpscare" ? 38 : 108, now + 0.38);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(effect === "jumpscare" ? 0.13 : 0.055, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.52);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.56);
    },
    [ensureAudio],
  );

  return { ensureAudio, playEffect };
}

function App() {
  const gameRef = useRef<Phaser.Game | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const particleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const miniMapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const miniMapSnapshotRef = useRef<MiniMapSnapshot>({ player: { x: 16.2, y: 30.6 }, ghostVisible: false });
  const miniMapFrameRef = useRef<number | null>(null);
  const [hud, setHud] = useState<GameHudEvent>(initialHud);
  const [storyState, setStoryState] = useState<StoryState>(() => createStoryState());
  const [activeSceneId, setActiveSceneId] = useState<StorySceneId | null>(null);
  const [screenEffect, setScreenEffect] = useState<HorrorEffect | "low-sanity" | "">("");
  const [nextObjectiveCue, setNextObjectiveCue] = useState<NextObjectiveCue | null>(null);
  const [gameSessionId, setGameSessionId] = useState(0);
  const { ensureAudio, playEffect } = useHorrorAudio();

  const currentScene = storyScenes[storyState.currentSceneId];
  const activeScene = activeSceneId ? storyScenes[activeSceneId] : null;
  const targetHotspotId = getSceneHotspot(storyState.currentSceneId);
  const targetHotspot = getHotspotById(targetHotspotId);

  useEffect(() => {
    const unlockAudio = () => ensureAudio();
    window.addEventListener("pointerdown", unlockAudio, { once: true });
    window.addEventListener("keydown", unlockAudio, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, [ensureAudio]);

  useEffect(() => {
    const canvas = particleCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const particles = Array.from({ length: 90 }, (_, index) => ({
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

    const handleMiniMap = (event: Event) => {
      miniMapSnapshotRef.current = (event as CustomEvent<GameMiniMapEvent>).detail;
      scheduleDraw();
    };

    drawMiniMap(canvas, miniMapSnapshotRef.current);
    window.addEventListener("resize", scheduleDraw);
    window.addEventListener("zju-horror-minimap", handleMiniMap);
    return () => {
      if (miniMapFrameRef.current !== null) window.cancelAnimationFrame(miniMapFrameRef.current);
      miniMapFrameRef.current = null;
      window.removeEventListener("resize", scheduleDraw);
      window.removeEventListener("zju-horror-minimap", handleMiniMap);
    };
  }, []);

  useEffect(() => {
    const handleHud = (event: Event) => {
      setHud((event as CustomEvent<GameHudEvent>).detail);
    };

    const handleOpenStory = (event: Event) => {
      const detail = (event as CustomEvent<{ hotspotId: HotspotId; sceneId: StorySceneId }>).detail;
      const sceneId = currentScene.locationId === detail.hotspotId ? storyState.currentSceneId : detail.sceneId;
      const scene = storyScenes[sceneId];

      setStoryState((previous) => ({
        ...previous,
        visitedHotspots: uniqueValues([...previous.visitedHotspots, scene.locationId]),
        log: appendLog(previous.log, `抵达 ${getHotspotById(scene.locationId)?.place ?? scene.title}`),
      }));
      setActiveSceneId(sceneId);
      playEffect(scene.effect ?? "whisper");
      window.dispatchEvent(new CustomEvent("zju-horror-effect", { detail: { effect: scene.effect ?? "whisper" } }));
    };

    window.addEventListener("zju-horror-hud", handleHud);
    window.addEventListener("zju-horror-open-story", handleOpenStory);
    return () => {
      window.removeEventListener("zju-horror-hud", handleHud);
      window.removeEventListener("zju-horror-open-story", handleOpenStory);
    };
  }, [currentScene.locationId, playEffect, storyState.currentSceneId]);

  useEffect(() => {
    if (!containerRef.current) return;
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
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      render: {
        antialias: true,
        pixelArt: false,
      },
    });

    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, [gameSessionId]);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("zju-horror-map-state", {
        detail: {
          guideHotspotId: targetHotspotId,
          completedHotspotIds: storyState.completedHotspots,
          visitedHotspotIds: storyState.visitedHotspots,
          sanity: storyState.stats.sanity,
          activeStory: Boolean(activeSceneId),
        },
      }),
    );
  }, [
    activeSceneId,
    storyState.completedHotspots,
    storyState.stats.sanity,
    storyState.visitedHotspots,
    targetHotspotId,
  ]);

  useEffect(() => {
    if (storyState.stats.sanity > 30 || screenEffect) return;
    setScreenEffect("low-sanity");
  }, [screenEffect, storyState.stats.sanity]);

  useEffect(() => {
    if (!nextObjectiveCue) return;
    const timer = window.setTimeout(() => setNextObjectiveCue(null), 4200);
    return () => window.clearTimeout(timer);
  }, [nextObjectiveCue]);

  const triggerEffect = useCallback(
    (effect?: HorrorEffect) => {
      if (!effect) return;
      setScreenEffect(effect);
      playEffect(effect);
      window.dispatchEvent(new CustomEvent("zju-horror-effect", { detail: { effect } }));
      window.setTimeout(() => setScreenEffect(""), effect === "jumpscare" ? 760 : 520);
    },
    [playEffect],
  );

  const restartGame = useCallback(() => {
    setStoryState(createStoryState());
    setActiveSceneId(null);
    setHud(initialHud);
    setScreenEffect("");
    setNextObjectiveCue(null);
    miniMapSnapshotRef.current = { player: { x: 16.2, y: 30.6 }, ghostVisible: false };
    setGameSessionId((value) => value + 1);
  }, []);

  useEffect(() => {
    const handleGhostHit = (event: Event) => {
      const detail = (event as CustomEvent<{ type: "sanity" | "death"; amount?: number }>).detail;
      if (detail.type === "death") {
        setNextObjectiveCue(null);
        setStoryState((previous) => ({
          ...previous,
          currentSceneId: "death_sanity",
          stats: { ...previous.stats, sanity: 0 },
          log: appendLog(previous.log, "红色鬼影贴到背后，你被拖进了地图外侧的黑暗。"),
        }));
        setActiveSceneId("death_sanity");
        triggerEffect("jumpscare");
        return;
      }

      let becameDead = false;
      setStoryState((previous) => {
        const nextSanity = clampStat(previous.stats.sanity + (detail.amount ?? -8));
        const dead = nextSanity <= 0;
        becameDead = dead;
        return {
          ...previous,
          currentSceneId: dead ? "death_sanity" : previous.currentSceneId,
          stats: { ...previous.stats, sanity: nextSanity },
          log: appendLog(previous.log, "红色鬼影靠得太近，理智被撕下一截。"),
        };
      });
      if (becameDead) {
        setNextObjectiveCue(null);
        setActiveSceneId("death_sanity");
      }
      triggerEffect("jumpscare");
    };

    window.addEventListener("zju-horror-ghost-hit", handleGhostHit);
    return () => window.removeEventListener("zju-horror-ghost-hit", handleGhostHit);
  }, [triggerEffect]);

  const useInventoryItem = useCallback(
    (itemId: ItemId) => {
      if (itemId !== "medicine" && itemId !== "energy") return;
      setStoryState((previous) => {
        if (!previous.inventory.includes(itemId)) return previous;
        const inventory = previous.inventory.filter((id) => id !== itemId);
        const stats = { ...previous.stats };
        if (itemId === "medicine") stats.sanity = clampStat(stats.sanity + 20);
        if (itemId === "energy") stats.stamina = clampStat(stats.stamina + 30);
        return {
          ...previous,
          stats,
          inventory,
          log: appendLog(previous.log, itemId === "medicine" ? "服用镇定药，理智恢复。" : "饮用能量饮料，体力恢复。"),
        };
      });
      triggerEffect("reveal");
    },
    [triggerEffect],
  );

  const choose = useCallback(
    (choice: StoryChoice) => {
      if (!activeScene || isChoiceLocked(choice, storyState)) return;

      const currentLocation = activeScene.locationId;
      const applied = applyStatChanges(storyState, choice.statChanges);
      const gainedItems = uniqueValues([
        ...applied.inventory,
        ...(choice.gainItem ? [choice.gainItem] : []),
        ...(choice.gainItems ?? []),
      ]);
      let nextSceneId = choice.next;
      const nextFlags = { ...storyState.flags };
      if (choice.setFlag) nextFlags[choice.setFlag] = true;

      let nextStats = applied.stats;
      if (nextStats.sanity <= 0) nextSceneId = "death_sanity";
      if (nextSceneId.startsWith("ending") && nextStats.sanity <= 20 && nextStats.clues >= 15) {
        nextSceneId = "ending_nightmare";
      }

      const nextScene = storyScenes[nextSceneId];
      const nextHotspot = getHotspotById(nextScene.locationId);
      const changesLocation = nextScene.locationId !== currentLocation;
      const completedHotspots = uniqueValues(
        changesLocation || nextScene.ending
          ? [...storyState.completedHotspots, currentLocation]
          : storyState.completedHotspots,
      );

      const itemLine = choice.gainItem
        ? `获得「${itemCatalog[choice.gainItem].name}」。`
        : choice.gainItems?.length
          ? `获得${choice.gainItems.map((id) => `「${itemCatalog[id].name}」`).join("、")}。`
          : "";
      const talismanLine = applied.blockedByTalisman ? "护身符发烫，替你挡下了一次精神侵蚀。" : "";

      nextStats = { ...nextStats };
      const nextPlaceLine = changesLocation && !nextScene.ending && nextHotspot ? `下一站：${nextHotspot.place}` : "";

      setStoryState({
        ...storyState,
        currentSceneId: nextSceneId,
        stats: nextStats,
        inventory: gainedItems,
        flags: nextFlags,
        visitedHotspots: uniqueValues([...storyState.visitedHotspots, currentLocation]),
        completedHotspots,
        log: appendLog(storyState.log, [choice.text, talismanLine, itemLine, nextPlaceLine].filter(Boolean).join(" ")),
      });

      triggerEffect(choice.effect ?? nextScene.effect);

      if (nextScene.ending || nextScene.locationId === currentLocation) {
        setNextObjectiveCue(null);
        setActiveSceneId(nextSceneId);
      } else {
        if (nextHotspot) {
          setNextObjectiveCue({ place: nextHotspot.place, objective: nextHotspot.objective });
        }
        setActiveSceneId(null);
      }
    },
    [activeScene, storyState, triggerEffect],
  );

  const usableItems = useMemo<Set<ItemId>>(
    () => new Set(storyState.inventory.filter((id) => id === "medicine" || id === "energy")),
    [storyState.inventory],
  );

  const rootClass = ["appShell", screenEffect ? `fx-${screenEffect}` : ""].filter(Boolean).join(" ");
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
          {(Object.entries(storyState.stats) as Array<[StatKey, number]>).map(([key, value]) => {
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
        <div className={screenEffect === "jumpscare" ? "jumpscareOverlay active" : "jumpscareOverlay"} />
        <div className={screenEffect === "jumpscare" ? "jumpscareText active" : "jumpscareText"}>别回头</div>

        {nextObjectiveCue && !activeScene && (
          <div className="routeCue" role="status">
            <span>下一段</span>
            <strong>{nextObjectiveCue.place}</strong>
            <em>{nextObjectiveCue.objective}</em>
          </div>
        )}

        {activeScene && (
          <section className={activeScene.ending ? "storyModal ending" : "storyModal"} aria-live="polite">
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
                    <button className={locked ? "choiceButton locked" : "choiceButton"} disabled={locked} key={choice.id} onClick={() => choose(choice)}>
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
    </main>
  );
}

export default App;
