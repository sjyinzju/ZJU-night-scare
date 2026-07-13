import { useEffect, useRef, useCallback, useState, type CSSProperties } from "react";
import { Interior3D } from "./Interior3D";
import { useGameStore } from "../store";

export interface InteriorOverlayProps {
  building: { id: string; name: string; zone?: string };
  currentSceneId: string;
  inventory: string[];
  onExit: () => void;
  /** A story interior can only leave through its active narrative exit. */
  canExit?: boolean;
  onExitTrigger?: () => void;
  onLevelExit?: (levelId: "baisha-dorm") => void;
  onLevelDeath?: (levelId: "baisha-dorm") => void;
  /** When true, shows a virtual joystick + drag-to-look controls. */
  isMobile?: boolean;
}

const JOYSTICK_RADIUS = 56;

// ── 3D内景小地图（右上角俯视图）──

interface MiniMapSnap {
  playerX: number;
  playerZ: number;
  ghostX: number;
  ghostZ: number;
  ghostVisible: boolean;
}

/** 小地图覆盖的游戏世界范围 */
const MM_BOUNDS = { minX: -12, maxX: 30, minZ: -5, maxZ: 29 };

function toCanvas(gameX: number, gameZ: number, cw: number, ch: number) {
  const x = ((gameX - MM_BOUNDS.minX) / (MM_BOUNDS.maxX - MM_BOUNDS.minX)) * cw;
  const y = ((MM_BOUNDS.maxZ - gameZ) / (MM_BOUNDS.maxZ - MM_BOUNDS.minZ)) * ch;
  return { x, y };
}

function drawInteriorMiniMap(canvas: HTMLCanvasElement, snap: MiniMapSnap): void {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  if (!w || !h) return;

  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // 背景
  ctx.fillStyle = "rgba(3, 6, 10, 0.88)";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(215, 183, 118, 0.35)";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

  // ── 走廊轮廓 ──
  // 外环外墙
  const outer = [
    toCanvas(-10.3, -3.3, w, h), toCanvas(27.7, -3.3, w, h),
    toCanvas(27.7, 27.3, w, h), toCanvas(-10.3, 27.3, w, h),
  ];
  ctx.beginPath();
  ctx.moveTo(outer[0].x, outer[0].y);
  for (let i = 1; i < outer.length; i++) ctx.lineTo(outer[i].x, outer[i].y);
  ctx.closePath();
  ctx.strokeStyle = "rgba(168, 146, 118, 0.55)";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // 内环内墙（中央区域）
  const inner = [
    toCanvas(-7.5, 9.3, w, h), toCanvas(24.2, 9.3, w, h),
    toCanvas(24.2, 24.2, w, h), toCanvas(-7.5, 24.2, w, h),
  ];
  ctx.beginPath();
  ctx.moveTo(inner[0].x, inner[0].y);
  for (let i = 1; i < inner.length; i++) ctx.lineTo(inner[i].x, inner[i].y);
  ctx.closePath();
  ctx.strokeStyle = "rgba(168, 146, 118, 0.38)";
  ctx.setLineDash([3, 3]);
  ctx.stroke();
  ctx.setLineDash([]);

  // 宿舍（左下角实心矩形）
  const dorm = { x: toCanvas(-8, 0, w, h).x, y: toCanvas(-8, 9.3, w, h).y, w: toCanvas(-1.3, 0, w, h).x - toCanvas(-8, 0, w, h).x, h: toCanvas(-8, 0, w, h).y - toCanvas(-8, 9.3, w, h).y };
  ctx.fillStyle = "rgba(110, 140, 155, 0.30)";
  ctx.fillRect(dorm.x, dorm.y, dorm.w, dorm.h);
  ctx.strokeStyle = "rgba(140, 170, 185, 0.50)";
  ctx.lineWidth = 1;
  ctx.strokeRect(dorm.x, dorm.y, dorm.w, dorm.h);

  // 中横廊鬼捷径
  const sc = { x: toCanvas(-7.5, 14, w, h).x, y: toCanvas(-7.5, 17, w, h).y, w: toCanvas(10, 14, w, h).x - toCanvas(-7.5, 14, w, h).x, h: toCanvas(-7.5, 14, w, h).y - toCanvas(-7.5, 17, w, h).y };
  ctx.fillStyle = "rgba(180, 60, 50, 0.16)";
  ctx.fillRect(sc.x, sc.y, sc.w, sc.h);
  ctx.strokeStyle = "rgba(200, 70, 60, 0.32)";
  ctx.setLineDash([2, 4]);
  ctx.strokeRect(sc.x, sc.y, sc.w, sc.h);
  ctx.setLineDash([]);

  // 出口标记（左下角）
  const exit = toCanvas(-8.5, -1, w, h);
  ctx.fillStyle = "#d7b776";
  ctx.beginPath();
  ctx.moveTo(exit.x, exit.y - 4);
  ctx.lineTo(exit.x + 4, exit.y + 3);
  ctx.lineTo(exit.x - 4, exit.y + 3);
  ctx.closePath();
  ctx.fill();

  // ── 玩家（绿色圆点 + 光晕）──
  const player = toCanvas(snap.playerX, snap.playerZ, w, h);
  ctx.shadowColor = "rgba(130, 230, 160, 0.7)";
  ctx.shadowBlur = 5;
  ctx.fillStyle = "#82e6a0";
  ctx.beginPath();
  ctx.arc(player.x, player.y, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // ── 鬼（红色圆点，仅可见时显示）──
  if (snap.ghostVisible) {
    const ghost = toCanvas(snap.ghostX, snap.ghostZ, w, h);
    ctx.shadowColor = "rgba(255, 40, 40, 0.85)";
    ctx.shadowBlur = 7;
    ctx.fillStyle = "#ff2020";
    ctx.beginPath();
    ctx.arc(ghost.x, ghost.y, 3.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

/**
 * Full-screen overlay hosting a first-person interior exploration scene.
 * Owns the Interior3D lifecycle: creates it on mount, disposes on unmount.
 */
export default function InteriorOverlay({
  building,
  currentSceneId,
  inventory,
  onExit,
  canExit = true,
  onExitTrigger,
  onLevelExit,
  onLevelDeath,
  isMobile = false,
}: InteriorOverlayProps): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Interior3D | null>(null);
  const miniMapRef = useRef<HTMLCanvasElement | null>(null);
  const miniMapFrameRef = useRef<number | null>(null);
  const currentSceneIdRef = useRef(currentSceneId);
  const inventoryRef = useRef(inventory);
  // WebGL 初始化失败（部分低端/受限浏览器无法创建 WebGL 上下文）时降级为提示。
  const [failed, setFailed] = useState(false);
  // GLB 加载进度
  const [loadFraction, setLoadFraction] = useState(0);
  const [assetLoaded, setAssetLoaded] = useState(false);
  // 拾取道具时的短暂提示文案。
  const [pickupToast, setPickupToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  // Joystick state.
  const joyRef = useRef<HTMLDivElement>(null);
  const joyKnobRef = useRef<HTMLDivElement>(null);
  const joyPointerId = useRef<number | null>(null);
  const joyOrigin = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Look-drag state (right half of the screen).
  const lookPointerId = useRef<number | null>(null);
  const lookLast = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    currentSceneIdRef.current = currentSceneId;
  }, [currentSceneId]);

  useEffect(() => {
    inventoryRef.current = inventory;
  }, [inventory]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let engine: Interior3D | null = null;
    try {
      engine = new Interior3D({
        container: host,
        buildingId: building.id,
        zone: building.zone,
        isMobile,
        getStorySceneId: () => currentSceneIdRef.current,
        getInventory: () => inventoryRef.current,
        getDoorInventory: () => inventoryRef.current,
        onPickup: (itemId, name) => {
          // 通知外层剧情系统把道具加入物品栏，并弹一个短暂提示。
          window.dispatchEvent(new CustomEvent("zju-horror-pickup", { detail: { itemId, name } }));
          setPickupToast(name);
          if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
          toastTimer.current = window.setTimeout(() => setPickupToast(null), 2600);
        },
        onStoryTrigger: (sceneId) => {
          engineRef.current?.exitPointerLock();
          window.dispatchEvent(new CustomEvent("zju-horror-interior-story", { detail: { sceneId } }));
        },
        onExitTrigger: () => {
          engineRef.current?.exitPointerLock();
          (onExitTrigger ?? onExit)();
        },
        onLevelExit: (levelId) => {
          engineRef.current?.exitPointerLock();
          onLevelExit?.(levelId);
        },
        onLevelDeath: (levelId) => {
          engineRef.current?.exitPointerLock();
          onLevelDeath?.(levelId);
        },
        getStamina: () => useGameStore.getState().storyState.stats.stamina,
        setStamina: (v) => {
          const s = useGameStore.getState();
          s.setStoryState((prev) => ({
            ...prev,
            stats: { ...prev.stats, stamina: Math.max(0, Math.min(100, Math.round(v))) },
          }));
        },
      });
      engineRef.current = engine;
      engine.start();
    } catch (err) {
      // 通常是 WebGL 上下文创建失败——不让异常冒泡破坏外层地图，改为降级提示。
      console.warn("[InteriorOverlay] 3D 内景初始化失败，降级为提示：", err);
      setFailed(true);
      try {
        engine?.dispose();
      } catch {
        /* ignore */
      }
      engineRef.current = null;
      return;
    }
    return () => {
      engine?.dispose();
      engineRef.current = null;
    };
  }, [building.id, building.zone, isMobile]);

  // 卸载时清掉拾取提示定时器。
  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
  }, []);

  // GLB 加载进度监听
  useEffect(() => {
    const onProgress = (event: Event) => {
      const { fraction } = (event as CustomEvent<{ fraction: number }>).detail;
      setLoadFraction(fraction);
      if (fraction >= 1) setAssetLoaded(true);
    };
    const onAssetState = (event: Event) => {
      const { loaded } = (event as CustomEvent<{ loaded: boolean }>).detail;
      if (loaded) { setLoadFraction(1); setAssetLoaded(true); }
    };
    window.addEventListener("zju-horror-interior-load-progress", onProgress);
    window.addEventListener("zju-horror-interior-asset-state", onAssetState);
    return () => {
      window.removeEventListener("zju-horror-interior-load-progress", onProgress);
      window.removeEventListener("zju-horror-interior-asset-state", onAssetState);
    };
  }, []);

  // 建筑切换时重置
  useEffect(() => {
    setLoadFraction(0);
    setAssetLoaded(false);
  }, [building.id]);

  // ── 小地图绘制循环（每 200ms 刷新）──
  useEffect(() => {
    const canvas = miniMapRef.current;
    if (!canvas || isMobile) return; // 桌面端显示，移动端隐藏节省性能

    let running = true;
    const draw = () => {
      if (!running) return;
      const engine = engineRef.current;
      if (!engine) { miniMapFrameRef.current = window.setTimeout(draw, 200); return; }
      const snap = engine.getMiniMapSnapshot();
      if (snap) drawInteriorMiniMap(canvas, snap);
      miniMapFrameRef.current = window.setTimeout(draw, 200);
    };
    miniMapFrameRef.current = window.setTimeout(draw, 100);

    return () => {
      running = false;
      if (miniMapFrameRef.current !== null) window.clearTimeout(miniMapFrameRef.current);
    };
  }, [isMobile, building.id]);

  const handleExit = useCallback(() => {
    if (!canExit) return;
    engineRef.current?.exitPointerLock();
    onExit();
  }, [canExit, onExit]);

  // ---- Joystick pointer handlers ----
  const onJoyDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    joyPointerId.current = e.pointerId;
    const rect = e.currentTarget.getBoundingClientRect();
    joyOrigin.current = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onJoyMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (joyPointerId.current !== e.pointerId) return;
    e.preventDefault();
    let dx = e.clientX - joyOrigin.current.x;
    let dy = e.clientY - joyOrigin.current.y;
    const dist = Math.hypot(dx, dy);
    if (dist > JOYSTICK_RADIUS) {
      dx = (dx / dist) * JOYSTICK_RADIUS;
      dy = (dy / dist) * JOYSTICK_RADIUS;
    }
    const knob = joyKnobRef.current;
    if (knob) knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // Screen down (dy+) => move backward (forward = -dy).
    engineRef.current?.setMoveInput(dx / JOYSTICK_RADIUS, -dy / JOYSTICK_RADIUS);
  }, []);

  const onJoyUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (joyPointerId.current !== e.pointerId) return;
    joyPointerId.current = null;
    const knob = joyKnobRef.current;
    if (knob) knob.style.transform = "translate(0px, 0px)";
    engineRef.current?.setMoveInput(0, 0);
  }, []);

  // ---- Look-drag handlers (attached to the right-half surface) ----
  const onLookDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (lookPointerId.current !== null) return;
    lookPointerId.current = e.pointerId;
    lookLast.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onLookMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (lookPointerId.current !== e.pointerId) return;
    const dx = e.clientX - lookLast.current.x;
    const dy = e.clientY - lookLast.current.y;
    lookLast.current = { x: e.clientX, y: e.clientY };
    engineRef.current?.addLook(dx, dy);
  }, []);

  const onLookUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (lookPointerId.current !== e.pointerId) return;
    lookPointerId.current = null;
  }, []);

  // WebGL 不可用时的降级视图：保留氛围与离开入口，避免异常破坏外层地图。
  if (failed) {
    return (
      <div style={styles.root} className="interiorOverlay">
        <div style={styles.vignette} aria-hidden="true" />
        <div style={styles.title}>{building.name}</div>
        <div style={styles.fallback}>
          <p style={styles.fallbackTitle}>门后一片漆黑</p>
          <p style={styles.fallbackText}>这台设备暂时无法渲染建筑内部（WebGL 不可用）。</p>
          <button style={styles.fallbackBtn} onClick={handleExit} disabled={!canExit}>
            退回校园
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.root} className="interiorOverlay">
      <div ref={hostRef} style={styles.host} />

      {/* 氛围叠层：暗角 + 轻微冷调，与外层地图的恐怖质感统一。 */}
      <div style={styles.vignette} aria-hidden="true" />
      <div style={styles.scanline} aria-hidden="true" />

      {/* 右上角俯视图小地图 */}
      <canvas ref={miniMapRef} style={styles.miniMap} aria-label="走廊俯视图" />

      {/* GLB 加载进度条 */}
      {!assetLoaded && (
        <div style={styles.loadBar}>
          <div style={{ ...styles.loadBarFill, width: `${Math.round(loadFraction * 100)}%` }} />
          <span style={styles.loadBarLabel}>{Math.round(loadFraction * 100)}%</span>
        </div>
      )}

      {/* Mobile look surface covers the right half of the screen. */}
      {isMobile && (
        <div
          style={styles.lookSurface}
          onPointerDown={onLookDown}
          onPointerMove={onLookMove}
          onPointerUp={onLookUp}
          onPointerCancel={onLookUp}
        />
      )}

      {/* Top-right: leave the building. */}
      <button
        style={{ ...styles.exitBtn, ...(canExit ? undefined : styles.exitBtnDisabled) }}
        onClick={handleExit}
        disabled={!canExit}
      >
        {canExit ? "离开建筑" : "跟随红色指引"}
      </button>

      {/* Building label. */}
      <div style={styles.title}>{building.name}</div>

      {/* Pickup toast. */}
      {pickupToast && (
        <div style={styles.pickupToast}>
          <span>拾取</span>
          <strong>{pickupToast}</strong>
        </div>
      )}

      {/* Bottom control hint. */}
      <div style={styles.hint}>
        {isMobile
          ? "左下摇杆移动 · 右侧拖动看视角 · 右上角离开"
          : "点击画面锁定鼠标 · WASD/方向键移动 · 移动鼠标转视角 · Esc 释放"}
      </div>

      {/* Mobile virtual joystick, bottom-left. */}
      {isMobile && (
        <div
          ref={joyRef}
          style={styles.joystick}
          onPointerDown={onJoyDown}
          onPointerMove={onJoyMove}
          onPointerUp={onJoyUp}
          onPointerCancel={onJoyUp}
        >
          <div ref={joyKnobRef} style={styles.joyKnob} />
        </div>
      )}
    </div>
  );
}

const FONT_STACK =
  'Inter, "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif';

const styles: Record<string, CSSProperties> = {
  root: {
    position: "fixed",
    inset: 0,
    zIndex: 1000,
    background: "#05060a",
    overflow: "hidden",
    userSelect: "none",
    WebkitUserSelect: "none",
    touchAction: "none",
    fontFamily: FONT_STACK,
    animation: "interiorFadeIn 0.55s ease-out both",
  },
  host: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
  },
  // 暗角：四周压暗，聚焦画面中心，和外层 .vignette 呼应。
  vignette: {
    position: "absolute",
    inset: 0,
    zIndex: 2,
    pointerEvents: "none",
    // 柔和暗角:中央 ~56% 完全通透、边缘渐暗,近黑只在最外角落(约5-8%)。
    // 比旧版(0.55@82% / 0.9@100% 且中心偏上使下方更黑)整体减弱约一半。
    background:
      "radial-gradient(ellipse 124% 118% at 50% 50%, transparent 56%, rgba(4,5,9,0.2) 80%, rgba(2,3,6,0.46) 92%, rgba(0,0,0,0.8) 100%)",
    mixBlendMode: "multiply",
  },
  // 小地图：右上角俯视图
  miniMap: {
    position: "absolute",
    top: 52,
    right: 16,
    zIndex: 6,
    width: 146,
    height: 118,
    borderRadius: 6,
    border: "1px solid rgba(215, 183, 118, 0.30)",
    boxShadow: "0 6px 18px rgba(0, 0, 0, 0.55)",
    pointerEvents: "none",
  },
  // 加载进度条
  loadBar: {
    position: "absolute",
    bottom: 60,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 6,
    width: 220,
    height: 6,
    borderRadius: 3,
    background: "rgba(21, 15, 15, 0.72)",
    border: "1px solid rgba(179, 50, 46, 0.4)",
    overflow: "hidden",
  },
  loadBarFill: {
    height: "100%",
    borderRadius: 2,
    background: "linear-gradient(90deg, #6a2020, #b3322e, #d74a3a)",
    transition: "width 0.2s ease-out",
  },
  loadBarLabel: {
    position: "absolute",
    top: -22,
    left: "50%",
    transform: "translateX(-50%)",
    color: "#c9a87c",
    fontSize: 12,
    letterSpacing: "0.08em",
    textShadow: "0 0 6px rgba(0,0,0,0.9)",
  },
  // 扫描线：极淡的冷调横纹，制造老旧监控/胶片质感。
  scanline: {
    position: "absolute",
    inset: 0,
    zIndex: 2,
    pointerEvents: "none",
    opacity: 0.28,
    background:
      "repeating-linear-gradient(0deg, rgba(120,140,150,0.05) 0px, rgba(120,140,150,0.05) 1px, transparent 1px, transparent 3px)",
  },
  lookSurface: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: "50%",
    touchAction: "none",
    zIndex: 3,
  },
  exitBtn: {
    position: "absolute",
    top: 16,
    right: 16,
    zIndex: 5,
    padding: "10px 20px",
    background: "rgba(21,15,15,0.72)",
    color: "#d7b776",
    border: "1px solid rgba(179,50,46,0.6)",
    borderRadius: 9,
    fontSize: 14,
    fontFamily: FONT_STACK,
    letterSpacing: "0.14em",
    cursor: "pointer",
    backdropFilter: "blur(6px)",
    boxShadow: "0 10px 26px rgba(0,0,0,0.42), 0 0 20px rgba(179,50,46,0.18)",
  },
  exitBtnDisabled: {
    cursor: "not-allowed",
    opacity: 0.52,
  },
  title: {
    position: "absolute",
    top: 20,
    left: 22,
    zIndex: 5,
    color: "#d7b776",
    fontSize: 15,
    fontWeight: 600,
    letterSpacing: "0.28em",
    textShadow: "0 0 10px rgba(0,0,0,0.95)",
    pointerEvents: "none",
  },
  hint: {
    position: "absolute",
    bottom: 20,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 5,
    color: "rgba(153,140,125,0.85)",
    fontSize: 12.5,
    letterSpacing: "0.12em",
    textAlign: "center",
    textShadow: "0 0 8px rgba(0,0,0,0.95)",
    pointerEvents: "none",
    padding: "0 14px",
    whiteSpace: "nowrap",
    maxWidth: "94vw",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  joystick: {
    position: "absolute",
    left: 28,
    bottom: 40,
    zIndex: 6,
    width: JOYSTICK_RADIUS * 2,
    height: JOYSTICK_RADIUS * 2,
    borderRadius: "50%",
    background: "rgba(215,183,118,0.05)",
    border: "1px solid rgba(215,183,118,0.22)",
    boxShadow: "inset 0 0 18px rgba(0,0,0,0.5)",
    touchAction: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  joyKnob: {
    width: 48,
    height: 48,
    borderRadius: "50%",
    background: "rgba(215,183,118,0.32)",
    border: "1px solid rgba(215,183,118,0.5)",
    boxShadow: "0 0 14px rgba(179,50,46,0.25)",
    pointerEvents: "none",
    transition: "transform 0.02s linear",
  },
  pickupToast: {
    position: "absolute",
    top: 64,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 6,
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    padding: "8px 18px",
    background: "rgba(21,15,15,0.82)",
    border: "1px solid rgba(215,183,118,0.5)",
    borderRadius: 8,
    color: "#f3d79a",
    fontSize: 15,
    letterSpacing: "0.12em",
    boxShadow: "0 8px 22px rgba(0,0,0,0.5), 0 0 18px rgba(215,183,118,0.25)",
    animation: "interiorFadeIn 0.3s ease-out both",
  },
  fallback: {
    position: "absolute",
    inset: 0,
    zIndex: 5,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    padding: "0 28px",
    textAlign: "center",
  },
  fallbackTitle: {
    color: "#f3d79a",
    fontSize: 23,
    fontWeight: 700,
    letterSpacing: "0.22em",
    margin: 0,
    textShadow: "0 2px 10px rgba(0,0,0,0.9), 0 0 18px rgba(179,50,46,0.4)",
  },
  fallbackText: {
    color: "#cabfae",
    fontSize: 14,
    letterSpacing: "0.06em",
    margin: 0,
    maxWidth: 320,
    lineHeight: 1.7,
    textShadow: "0 1px 6px rgba(0,0,0,0.9)",
  },
  fallbackBtn: {
    marginTop: 8,
    padding: "11px 26px",
    background: "rgba(21,15,15,0.8)",
    color: "#d7b776",
    border: "1px solid rgba(179,50,46,0.6)",
    borderRadius: 9,
    fontSize: 14,
    fontFamily: FONT_STACK,
    letterSpacing: "0.16em",
    cursor: "pointer",
  },
};
