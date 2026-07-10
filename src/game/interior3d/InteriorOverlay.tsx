import { useEffect, useRef, useCallback, useState, type CSSProperties } from "react";
import { Interior3D } from "./Interior3D";
import { useGameStore } from "../store";

export interface InteriorOverlayProps {
  building: { id: string; name: string; zone?: string };
  currentSceneId: string;
  inventory: string[];
  onExit: () => void;
  onExitTrigger?: () => void;
  /** When true, shows a virtual joystick + drag-to-look controls. */
  isMobile?: boolean;
}

const JOYSTICK_RADIUS = 56;

/**
 * Full-screen overlay hosting a first-person interior exploration scene.
 * Owns the Interior3D lifecycle: creates it on mount, disposes on unmount.
 */
export default function InteriorOverlay({
  building,
  currentSceneId,
  inventory,
  onExit,
  onExitTrigger,
  isMobile = false,
}: InteriorOverlayProps): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Interior3D | null>(null);
  const currentSceneIdRef = useRef(currentSceneId);
  const inventoryRef = useRef(inventory);
  // WebGL 初始化失败（部分低端/受限浏览器无法创建 WebGL 上下文）时降级为提示。
  const [failed, setFailed] = useState(false);
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

  const handleExit = useCallback(() => {
    engineRef.current?.exitPointerLock();
    onExit();
  }, [onExit]);

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
          <button style={styles.fallbackBtn} onClick={onExit}>
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
      <button style={styles.exitBtn} onClick={handleExit}>
        离开建筑
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
