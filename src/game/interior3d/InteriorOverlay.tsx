import { useEffect, useRef, useCallback, useState, type CSSProperties } from "react";
import {
  Interior3D,
  type BaishaGameplayTrigger,
  type InteriorAssetState,
} from "./Interior3D";
import { useGameStore } from "../store";
import { JumpscarePipeline } from "../JumpscarePipeline";
import BaishaDormExperience, { type BaishaDormStage } from "./BaishaDormExperience";
import { shouldUseBaishaDirectChaseTest } from "./baishaDebug";
import MedicalTopExperience from "./MedicalTopExperience";
import type { MedicalTopModal, MedicalTopSnapshot } from "./medicalTopData";
import MedicalGarageExperience from "./MedicalGarageExperience";
import { MEDICAL_GARAGE_STEPS, type MedicalGarageModal, type MedicalGarageSnapshot } from "./medicalGarageData";
import MedicalBasementExperience from "./MedicalBasementExperience";
import {
  MEDICAL_BASEMENT_STEPS,
  type MedicalBasementConclusionId,
  type MedicalBasementEvidenceId,
  type MedicalBasementModal,
  type MedicalBasementSnapshot,
} from "./medicalBasementData";

export interface InteriorOverlayProps {
  building: { id: string; name: string; zone?: string };
  currentSceneId: string;
  inventory: string[];
  onExit: () => void;
  /** A story interior can only leave through its active narrative exit. */
  canExit?: boolean;
  onExitTrigger?: () => void;
  /** When true, shows a virtual joystick + drag-to-look controls. */
  isMobile?: boolean;
  /** Keeps the renderer hidden until authored static visuals are attached. */
  blockUntilAssetReady?: boolean;
  onAssetStateChange?: (state: InteriorAssetState) => void;
  onMedicalTopComplete?: (detail: { hasFuse: boolean; evidence?: string }) => void;
  onMedicalGarageComplete?: () => void;
  onMedicalBasementComplete?: (detail: {
    evidenceIds: MedicalBasementEvidenceId[];
    conclusion: MedicalBasementConclusionId;
  }) => void;
}

const JOYSTICK_RADIUS = 56;
const LIBRARY_STEPS = ["寻找手电筒", "笔记本", "借阅小票", "拾取符咒", "书架异响", "灯下的人", "离开图书馆"];
const BAISHA_STEPS = ["调查桌上相框", "照片发生异变", "查看阳台", "玻璃外的人影", "浏览校园论坛", "离开寝室"];
const MEDICAL_TOP_STEPS = ["阅读六层守则", "为病床让行", "核对601记录", "检查603标本", "查看605录像", "返回电梯"];
type PickupToast = { name: string; detail?: string };

function libraryProgressIndex(sceneId: string, inventory: string[]): number {
  if (sceneId === "library_intro") return inventory.includes("flashlight") ? 1 : 0;
  if (sceneId === "library_receipt") return 2;
  if (sceneId === "library_talisman") return 3;
  if (sceneId === "library_shelf") return 4;
  if (sceneId === "library_fall") return 5;
  if (sceneId === "library_police") return 6;
  if (sceneId === "dorm_baiqiu") return 6;
  return 0;
}

function baishaProgressIndex(stage: BaishaDormStage): number {
  if (stage === "photo_target") return 0;
  if (["photo_intro", "photo_normal", "photo_flash_white", "photo_flash_red", "photo_corrupt", "photo_ready", "photo_dissolve"].includes(stage)) return 1;
  if (stage === "balcony_target") return 2;
  if (["balcony_flash", "balcony_wait", "balcony_story"].includes(stage)) return 3;
  if (["computer_target", "forum", "forum_ready", "forum_alarm", "forum_dissolve"].includes(stage)) return 4;
  return 5;
}

function medicalTopStepState(snapshot: MedicalTopSnapshot, index: number): { active: boolean; complete: boolean } {
  const afterRules = !["notice", "rules"].includes(snapshot.stage);
  const afterBed = ["rooms", "escape-warning", "escape", "transition"].includes(snapshot.stage);
  if (index === 0) return { active: ["notice", "rules"].includes(snapshot.stage), complete: afterRules };
  if (index === 1) return { active: ["bed-blackout", "bed"].includes(snapshot.stage), complete: afterBed };
  if (index === 2) return { active: snapshot.currentTarget === "601", complete: snapshot.rooms["601"] === "complete" && snapshot.currentTarget !== "601" };
  if (index === 3) return { active: snapshot.currentTarget === "603" || snapshot.currentTarget === "602", complete: snapshot.rooms["603"] === "complete" && snapshot.currentTarget !== "603" };
  if (index === 4) return { active: snapshot.currentTarget === "605", complete: snapshot.rooms["605"] === "complete" && snapshot.currentTarget !== "605" };
  const active = snapshot.currentTarget === "elevator" || (snapshot.stage === "rooms" && snapshot.currentTarget === undefined);
  return { active, complete: snapshot.stage === "transition" };
}

function medicalGarageStepState(snapshot: MedicalGarageSnapshot, index: number): { active: boolean; complete: boolean } {
  if (index === 0) return { active: snapshot.stage === "opening", complete: snapshot.stage !== "opening" };
  if (index === 1) return { active: snapshot.activatedNodes < 5 && snapshot.stage !== "opening", complete: snapshot.activatedNodes >= 5 };
  if (index === 2) return { active: snapshot.activatedNodes >= 4 && !snapshot.hasCandle, complete: snapshot.hasCandle };
  if (index === 3) return { active: snapshot.stage === "document", complete: snapshot.activatedNodes >= 6 && snapshot.stage !== "document" };
  if (index === 4) return { active: snapshot.stage === "seal", complete: ["stairs", "transition"].includes(snapshot.stage) };
  return { active: snapshot.stage === "stairs", complete: snapshot.stage === "transition" };
}

function medicalBasementStepState(snapshot: MedicalBasementSnapshot, index: number): { active: boolean; complete: boolean } {
  if (index === 0) return { active: snapshot.stage === "approach", complete: snapshot.stage !== "approach" };
  if (index === 1) return { active: ["approach", "clutter"].includes(snapshot.stage) && !snapshot.hasFeather, complete: snapshot.hasFeather };
  if (index === 2) return { active: snapshot.stage === "clutter", complete: snapshot.evidenceIds.length >= 2 };
  if (index === 3) return { active: snapshot.stage === "notebook" && !snapshot.notebookComplete, complete: snapshot.notebookComplete };
  if (index === 4) return { active: snapshot.stage === "notebook", complete: snapshot.notebookComplete };
  return { active: snapshot.stage === "locked", complete: snapshot.stage === "transition" };
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
  isMobile = false,
  blockUntilAssetReady = false,
  onAssetStateChange,
  onMedicalTopComplete,
  onMedicalGarageComplete,
  onMedicalBasementComplete,
}: InteriorOverlayProps): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const floorPlanRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Interior3D | null>(null);
  const currentSceneIdRef = useRef(currentSceneId);
  const inventoryRef = useRef(inventory);
  const onExitRef = useRef(onExit);
  const onExitTriggerRef = useRef(onExitTrigger);
  const onAssetStateChangeRef = useRef(onAssetStateChange);
  const onMedicalTopCompleteRef = useRef(onMedicalTopComplete);
  const onMedicalGarageCompleteRef = useRef(onMedicalGarageComplete);
  const onMedicalBasementCompleteRef = useRef(onMedicalBasementComplete);
  // WebGL 初始化失败（部分低端/受限浏览器无法创建 WebGL 上下文）时降级为提示。
  const [failed, setFailed] = useState(false);
  const [assetState, setAssetState] = useState<InteriorAssetState>("loading");
  // 拾取道具时的短暂提示文案。
  const [pickupToast, setPickupToast] = useState<PickupToast | null>(null);
  const toastTimer = useRef<number | null>(null);
  const [doorHint, setDoorHint] = useState("");
  const [doorMessage, setDoorMessage] = useState<string | null>(null);
  const doorMessageTimer = useRef<number | null>(null);
  const [debugMessage, setDebugMessage] = useState("");
  const [lightningFlash, setLightningFlash] = useState(false);
  const lightningTimer = useRef<number | null>(null);
  const [medicalGarageTextScare, setMedicalGarageTextScare] = useState<string | null>(null);
  const medicalGarageTextScareTimer = useRef<number | null>(null);
  const [baishaTrigger, setBaishaTrigger] = useState<BaishaGameplayTrigger | null>(null);
  const [baishaStage, setBaishaStage] = useState<BaishaDormStage>("photo_target");
  const [baishaChaseStarted, setBaishaChaseStarted] = useState(false);
  const [medicalTopSnapshot, setMedicalTopSnapshot] = useState<MedicalTopSnapshot | null>(null);
  const [medicalTopModal, setMedicalTopModal] = useState<MedicalTopModal | null>(null);
  const [medicalGarageSnapshot, setMedicalGarageSnapshot] = useState<MedicalGarageSnapshot | null>(null);
  const [medicalGarageModal, setMedicalGarageModal] = useState<MedicalGarageModal | null>(null);
  const [medicalBasementSnapshot, setMedicalBasementSnapshot] = useState<MedicalBasementSnapshot | null>(null);
  const [medicalBasementModal, setMedicalBasementModal] = useState<MedicalBasementModal | null>(null);
  const baishaEnergyBoost = useGameStore((state) => Boolean(state.storyState.flags.baishaEnergyBoost));
  const scene01Debug = building.id === "medical-library"
    && new URLSearchParams(window.location.search).get("debugScene01") === "1";
  const baishaGameplayDebug = building.id === "dorm-baisha"
    && new URLSearchParams(window.location.search).get("baishaGameplayDebug") === "1";
  const baishaChaseOnly = building.id === "dorm-baisha"
    && shouldUseBaishaDirectChaseTest();
  const medicalGameplayDebug = building.id === "medical-college"
    && new URLSearchParams(window.location.search).get("medicalGameplayDebug") === "1";
  const concealUntilAuthoredAssetReady = (
    building.id === "dorm-baisha" || building.id === "medical-college"
  ) && assetState !== "ready";

  useEffect(() => {
    if (!baishaChaseOnly || assetState !== "ready") return;
    engineRef.current?.resetBaishaChaseCheckpoint();
    setBaishaChaseStarted(false);
    setBaishaStage("complete");
  }, [assetState, baishaChaseOnly]);

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
    onAssetStateChangeRef.current = onAssetStateChange;
    onMedicalTopCompleteRef.current = onMedicalTopComplete;
    onMedicalGarageCompleteRef.current = onMedicalGarageComplete;
    onMedicalBasementCompleteRef.current = onMedicalBasementComplete;
  }, [onAssetStateChange, onMedicalBasementComplete, onMedicalGarageComplete, onMedicalTopComplete]);

  useEffect(() => {
    onExitRef.current = onExit;
    onExitTriggerRef.current = onExitTrigger;
  }, [onExit, onExitTrigger]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let engine: Interior3D | null = null;
    const reportAssetState = (state: InteriorAssetState): void => {
      setAssetState(state);
      onAssetStateChangeRef.current?.(state);
    };
    setFailed(false);
    reportAssetState("loading");
    try {
      engine = new Interior3D({
        container: host,
        buildingId: building.id,
        zone: building.zone,
        isMobile,
        getStorySceneId: () => currentSceneIdRef.current,
        getInventory: () => inventoryRef.current,
        getDoorInventory: () => inventoryRef.current,
        getSessionSeed: () => useGameStore.getState().sessionSeed,
        onPickup: (itemId, name) => {
          // 通知外层剧情系统把道具加入物品栏，并弹一个短暂提示。
          window.dispatchEvent(new CustomEvent("zju-horror-pickup", { detail: { itemId, name } }));
          if (itemId === "energy") setBaishaChaseStarted(true);
          setPickupToast({
            name,
            detail: itemId === "energy" ? "体力恢复 · 移动速度提升" : undefined,
          });
          if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
          toastTimer.current = window.setTimeout(() => setPickupToast(null), 2600);
        },
        onStoryTrigger: (sceneId) => {
          engineRef.current?.exitPointerLock();
          window.dispatchEvent(new CustomEvent("zju-horror-interior-story", { detail: { sceneId } }));
        },
        onExitTrigger: () => {
          engineRef.current?.exitPointerLock();
          (onExitTriggerRef.current ?? onExitRef.current)();
        },
        getStamina: () => useGameStore.getState().storyState.stats.stamina,
        setStamina: (v) => {
          const s = useGameStore.getState();
          const stamina = Math.max(0, Math.min(100, Math.round(v)));
          if (stamina === s.storyState.stats.stamina) return;
          s.setStoryState((prev) => ({
            ...prev,
            stats: { ...prev.stats, stamina },
          }));
        },
        onAssetStateChange: reportAssetState,
        onBaishaTrigger: (trigger) => {
          engineRef.current?.exitPointerLock();
          setBaishaTrigger(trigger);
        },
        onBaishaChaseStart: () => {
          engineRef.current?.exitPointerLock();
          setBaishaChaseStarted(true);
          JumpscarePipeline.executeStoryEffect("library_fall", 0.96, "快逃", "library-fall", 0);
        },
        onBaishaCapture: () => {
          engineRef.current?.exitPointerLock();
          JumpscarePipeline.executeStoryEffect(
            "ghost_caught",
            1,
            "你没能逃出白沙宿舍。",
            "library-fall",
            0,
          );
          window.dispatchEvent(new CustomEvent("zju-horror-baisha-capture"));
        },
        onBaishaExit: () => {
          engineRef.current?.exitPointerLock();
          (onExitTriggerRef.current ?? onExitRef.current)();
        },
        onMedicalTopStateChange: setMedicalTopSnapshot,
        onMedicalTopModal: (modal) => {
          engineRef.current?.exitPointerLock();
          setMedicalTopModal(modal);
        },
        onMedicalTopComplete: (detail) => {
          engineRef.current?.exitPointerLock();
          onMedicalTopCompleteRef.current?.(detail);
        },
        onMedicalGarageStateChange: setMedicalGarageSnapshot,
        onMedicalGarageModal: (modal) => {
          engineRef.current?.exitPointerLock();
          setMedicalGarageModal(modal);
        },
        onMedicalGarageComplete: () => {
          engineRef.current?.exitPointerLock();
          onMedicalGarageCompleteRef.current?.();
        },
        onMedicalBasementStateChange: setMedicalBasementSnapshot,
        onMedicalBasementModal: (modal) => {
          engineRef.current?.exitPointerLock();
          setMedicalBasementModal(modal);
        },
        onMedicalBasementComplete: (detail) => {
          engineRef.current?.exitPointerLock();
          onMedicalBasementCompleteRef.current?.(detail);
        },
      });
      engineRef.current = engine;
      engine.start();
    } catch (err) {
      // 通常是 WebGL 上下文创建失败——不让异常冒泡破坏外层地图，改为降级提示。
      console.warn("[InteriorOverlay] 3D 内景初始化失败，降级为提示：", err);
      setFailed(true);
      reportAssetState("failed");
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
    if (doorMessageTimer.current !== null) window.clearTimeout(doorMessageTimer.current);
    if (lightningTimer.current !== null) window.clearTimeout(lightningTimer.current);
    if (medicalGarageTextScareTimer.current !== null) window.clearTimeout(medicalGarageTextScareTimer.current);
  }, []);

  useEffect(() => {
    if (building.id !== "medical-library" && building.id !== "medical-college") return;
    const handleLightning = (event: Event): void => {
      const detail = (event as CustomEvent<{ active?: boolean; duration?: number }>).detail;
      const active = detail?.active;
      if (!active) {
        setLightningFlash(false);
        return;
      }
      setLightningFlash(true);
      if (lightningTimer.current !== null) window.clearTimeout(lightningTimer.current);
      lightningTimer.current = window.setTimeout(() => {
        lightningTimer.current = null;
        setLightningFlash(false);
      }, detail?.duration ?? 190);
    };
    window.addEventListener("zju-horror-library-lightning", handleLightning);
    window.addEventListener("zju-horror-medical-garage-lightning", handleLightning);
    return () => {
      window.removeEventListener("zju-horror-library-lightning", handleLightning);
      window.removeEventListener("zju-horror-medical-garage-lightning", handleLightning);
    };
  }, [building.id]);

  useEffect(() => {
    if (building.id !== "medical-college") return;
    const showTextScare = (event: Event): void => {
      const detail = (event as CustomEvent<{ text?: string; duration?: number }>).detail;
      if (!detail?.text) return;
      setMedicalGarageTextScare(null);
      window.requestAnimationFrame(() => setMedicalGarageTextScare(detail.text ?? null));
      if (medicalGarageTextScareTimer.current !== null) window.clearTimeout(medicalGarageTextScareTimer.current);
      medicalGarageTextScareTimer.current = window.setTimeout(() => {
        medicalGarageTextScareTimer.current = null;
        setMedicalGarageTextScare(null);
      }, detail.duration ?? 820);
    };
    window.addEventListener("zju-horror-medical-garage-text-scare", showTextScare);
    return () => window.removeEventListener("zju-horror-medical-garage-text-scare", showTextScare);
  }, [building.id]);

  useEffect(() => {
    if (building.id !== "dorm-baisha") return;
    const resetCheckpoint = (): void => {
      engineRef.current?.resetBaishaChaseCheckpoint();
      setBaishaTrigger(null);
      setBaishaChaseStarted(false);
      setBaishaStage("complete");
    };
    window.addEventListener("zju-horror-baisha-revive", resetCheckpoint);
    return () => window.removeEventListener("zju-horror-baisha-revive", resetCheckpoint);
  }, [building.id]);

  useEffect(() => {
    const refreshDoorHint = (): void => {
      const nextHint = engineRef.current?.doorHint ?? "";
      setDoorHint((previousHint) => previousHint === nextHint ? previousHint : nextHint);
    };
    const hintTimer = window.setInterval(refreshDoorHint, 100);
    const showDoorMessage = (event: Event): void => {
      const message = (event as CustomEvent<{ message?: string }>).detail?.message;
      if (!message) return;
      setDoorMessage(message);
      if (doorMessageTimer.current !== null) window.clearTimeout(doorMessageTimer.current);
      doorMessageTimer.current = window.setTimeout(() => setDoorMessage(null), 2600);
    };
    window.addEventListener("zju-horror-door-message", showDoorMessage);
    return () => {
      window.clearInterval(hintTimer);
      window.removeEventListener("zju-horror-door-message", showDoorMessage);
    };
  }, []);

  useEffect(() => {
    if (
      building.id !== "medical-library"
      && building.id !== "dorm-baisha"
      && building.id !== "medical-college"
    ) return;
    let frame = 0;
    let lastDraw = 0;
    const draw = (time: number): void => {
      frame = window.requestAnimationFrame(draw);
      if (time - lastDraw < 80) return;
      lastDraw = time;
      const canvas = floorPlanRef.current;
      const snapshot = engineRef.current?.getInteriorMapSnapshot();
      if (!canvas) return;
      const width = building.id === "medical-college" ? 280 : 154;
      const height = building.id === "medical-college" ? 150 : 250;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== width * pixelRatio || canvas.height !== height * pixelRatio) {
        canvas.width = width * pixelRatio;
        canvas.height = height * pixelRatio;
      }
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);
      if (!snapshot) return;

      const pad = 8;
      const spanX = snapshot.bounds.maxX - snapshot.bounds.minX;
      const spanZ = snapshot.bounds.maxZ - snapshot.bounds.minZ;
      const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanZ);
      const mapWidth = spanX * scale;
      const mapHeight = spanZ * scale;
      const offsetX = (width - mapWidth) / 2;
      const offsetY = (height - mapHeight) / 2;
      const mapX = (x: number) => offsetX + (x - snapshot.bounds.minX) * scale;
      // The authored Baisha model reads more naturally with the dormitory at
      // the lower-right of the plan. Mirror only its vertical map axis so the
      // room moves from upper-right to lower-right without swapping left/right.
      const mapY = building.id === "dorm-baisha"
        ? (z: number) => offsetY + (z - snapshot.bounds.minZ) * scale
        : (z: number) => offsetY + (snapshot.bounds.maxZ - z) * scale;

      context.fillStyle = "rgba(4, 7, 10, 0.82)";
      context.fillRect(offsetX, offsetY, mapWidth, mapHeight);
      if (building.id === "dorm-baisha" && snapshot.layoutPaths?.length) {
        context.lineJoin = "round";
        context.lineCap = "square";
        for (const path of snapshot.layoutPaths) {
          if (path.length < 2) continue;
          context.beginPath();
          context.moveTo(mapX(path[0].x), mapY(path[0].z));
          for (let index = 1; index < path.length; index++) {
            context.lineTo(mapX(path[index].x), mapY(path[index].z));
          }
          context.strokeStyle = "rgba(210, 220, 224, 0.86)";
          context.lineWidth = 5;
          context.stroke();
          context.strokeStyle = "rgba(7, 9, 11, 0.98)";
          context.lineWidth = 2.6;
          context.stroke();
        }
        // Retain only the large dorm furniture blocks. The raw corridor mesh
        // contains hundreds of tiny door/trim rectangles that previously made
        // the left half of the plan unreadable.
        // The chase map is a route diagram, not a furnished-room survey.
        // Drawing raw bed, chair and door-trim rectangles obscures the actual
        // walkable passages and creates false-looking branches near the dorm.
      } else {
        for (const obstacle of snapshot.obstacles) {
          context.fillStyle = obstacle.kind === "wall"
            ? "rgba(210, 220, 224, 0.86)"
            : obstacle.kind === "shelf"
              ? "rgba(166, 139, 90, 0.9)"
              : "rgba(111, 125, 128, 0.48)";
          context.fillRect(
            mapX(obstacle.minX),
            mapY(obstacle.maxZ),
            Math.max(1, (obstacle.maxX - obstacle.minX) * scale),
            Math.max(1, (obstacle.maxZ - obstacle.minZ) * scale),
          );
        }
      }
      context.strokeStyle = "rgba(215, 225, 228, 0.65)";
      context.lineWidth = 1;
      context.strokeRect(offsetX + 0.5, offsetY + 0.5, mapWidth - 1, mapHeight - 1);

      if (snapshot.exitSegment) {
        context.beginPath();
        context.moveTo(mapX(snapshot.exitSegment.minX), mapY(snapshot.exitSegment.z));
        context.lineTo(mapX(snapshot.exitSegment.maxX), mapY(snapshot.exitSegment.z));
        const markerGreen = snapshot.exitSegment.color === "green";
        context.strokeStyle = markerGreen ? "#44e36e" : "#f01824";
        context.shadowColor = markerGreen ? "rgba(68,227,110,0.95)" : "rgba(240,24,36,0.95)";
        context.shadowBlur = 8;
        context.lineWidth = 3;
        context.stroke();
        context.shadowBlur = 0;
      }

      const objectiveIsGarageNode = Boolean(snapshot.objective && snapshot.labels?.some((label) => (
        label.marker === "garage-node"
        && label.state === "target"
        && Math.hypot(label.x - snapshot.objective!.x, label.z - snapshot.objective!.z) < 0.1
      )));
      if (snapshot.objective && !objectiveIsGarageNode) {
        const objectiveX = mapX(snapshot.objective.x);
        const objectiveY = mapY(snapshot.objective.z);
        context.beginPath();
        context.arc(objectiveX, objectiveY, 3.7, 0, Math.PI * 2);
        context.fillStyle = "#ed111f";
        context.shadowColor = "rgba(255,17,31,1)";
        context.shadowBlur = 10;
        context.fill();
        context.shadowBlur = 0;
      }

      if (snapshot.routeLines?.length) {
        context.save();
        context.lineCap = "round";
        context.lineJoin = "round";
        for (const segment of snapshot.routeLines) {
          context.beginPath();
          context.moveTo(mapX(segment.from.x), mapY(segment.from.z));
          context.lineTo(mapX(segment.to.x), mapY(segment.to.z));
          context.strokeStyle = segment.complete ? "#d10a20" : "rgba(75, 24, 31, .42)";
          context.shadowColor = segment.complete ? "rgba(255, 8, 35, .9)" : "transparent";
          context.shadowBlur = segment.complete ? 7 : 0;
          context.lineWidth = segment.complete ? 2.2 : 1;
          context.stroke();
        }
        context.restore();
      }

      if (snapshot.labels?.length) {
        context.save();
        context.font = "700 11px Microsoft YaHei, sans-serif";
        context.textAlign = "center";
        context.textBaseline = "bottom";
        for (const label of snapshot.labels) {
          const x = mapX(label.x);
          const markerY = mapY(label.z);
          const y = markerY - (label.marker === "garage-node" ? 5.5 : 5);
          if (label.marker === "garage-node") {
            context.beginPath();
            context.arc(x, markerY, 3.35, 0, Math.PI * 2);
            if (label.state === "complete") {
              context.fillStyle = "#e3102b";
              context.shadowColor = "rgba(255, 12, 43, .95)";
              context.shadowBlur = 7;
              context.fill();
            } else {
              context.strokeStyle = label.state === "target" ? "#ff1835" : "rgba(245,248,250,.92)";
              context.lineWidth = label.state === "target" ? 2 : 1.35;
              context.shadowColor = label.state === "target" ? "rgba(255, 15, 45, .95)" : "rgba(255,255,255,.4)";
              context.shadowBlur = label.state === "target" ? 7 : 2;
              context.stroke();
            }
            context.shadowBlur = 0;
          }
          context.fillStyle = label.marker === "garage-node"
            ? label.state === "normal" ? "#ffffff" : "#ff2840"
            : label.state === "target"
              ? "#ff2537"
              : label.state === "complete"
                ? "#b99a57"
                : label.state === "abnormal"
                  ? "#ff001d"
                  : "#cbd3d3";
          context.shadowColor = label.state === "target" || label.state === "abnormal"
            ? "rgba(255,0,28,.95)"
            : "rgba(0,0,0,.9)";
          context.shadowBlur = label.state === "target" || label.state === "abnormal" ? 7 : 3;
          context.fillText(label.label, x, y);
        }
        context.restore();
      }

      if (snapshot.ghost?.state === "chase" || snapshot.ghost?.state === "garage") {
        const ghostX = mapX(snapshot.ghost.x);
        const ghostY = mapY(snapshot.ghost.z);
        const pulse = 4.1 + Math.sin(time * 0.012) * 0.8;
        context.beginPath();
        context.arc(ghostX, ghostY, pulse, 0, Math.PI * 2);
        context.fillStyle = "#ff101f";
        context.shadowColor = "rgba(255,16,31,1)";
        context.shadowBlur = 13;
        context.fill();
        context.shadowBlur = 0;
      }

      if (snapshot.fallenPerson) {
        const bodyX = mapX(snapshot.fallenPerson.x);
        const bodyY = mapY(snapshot.fallenPerson.z);
        context.save();
        context.translate(bodyX, bodyY);
        context.rotate(-0.72);
        context.strokeStyle = "#f4f4f1";
        context.fillStyle = "#f4f4f1";
        context.shadowColor = "rgba(255,255,255,0.95)";
        context.shadowBlur = 7;
        context.lineWidth = 2.2;
        context.beginPath();
        context.arc(-4.8, 0, 2.5, 0, Math.PI * 2);
        context.fill();
        context.beginPath();
        context.moveTo(-1.8, 0);
        context.lineTo(5.2, 0);
        context.lineTo(9.2, 3.8);
        context.moveTo(2.2, 0);
        context.lineTo(5.8, -4.1);
        context.stroke();
        context.restore();
      }

      const playerX = mapX(snapshot.player.x);
      const playerY = mapY(snapshot.player.z);
      context.beginPath();
      context.arc(playerX, playerY, 4.5, 0, Math.PI * 2);
      context.fillStyle = "rgba(255, 255, 255, 0.2)";
      context.fill();
      context.beginPath();
      context.arc(playerX, playerY, 2.25, 0, Math.PI * 2);
      context.fillStyle = "#ffffff";
      context.shadowColor = "rgba(255,255,255,0.95)";
      context.shadowBlur = 6;
      context.fill();
      context.shadowBlur = 0;
    };
    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, [building.id]);

  const handleExit = useCallback(() => {
    if (!canExit) return;
    engineRef.current?.exitPointerLock();
    onExit();
  }, [canExit, onExit]);

  // ---- Joystick pointer handlers ----
  const resetJoystick = useCallback(() => {
    joyPointerId.current = null;
    const knob = joyKnobRef.current;
    if (knob) knob.style.transform = "translate(0px, 0px)";
    engineRef.current?.setMoveInput(0, 0);
  }, []);

  useEffect(() => {
    const handlePointerRelease = (event: PointerEvent) => {
      if (joyPointerId.current === event.pointerId) resetJoystick();
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

  const onJoyDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    joyPointerId.current = e.pointerId;
    const rect = e.currentTarget.getBoundingClientRect();
    joyOrigin.current = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Safari can reject capture after an interrupted gesture.
    }
    engineRef.current?.setMoveInput(0, 0);
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
    resetJoystick();
  }, [resetJoystick]);

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
      <div
        ref={hostRef}
        style={{
          ...styles.host,
          ...(blockUntilAssetReady && assetState !== "ready" ? styles.hostBlocked : undefined),
        }}
      />
      <div className={["jumpscareText", medicalGarageTextScare ? "active" : ""].join(" ")}>
        {medicalGarageTextScare}
      </div>

      {/* Required authored scenes stay veiled until their GLB is ready. */}
      {concealUntilAuthoredAssetReady && (
        <div
          className="interiorAssetCurtain"
          style={styles.assetCurtain}
          role="status"
          aria-live="polite"
        >
          <span style={styles.assetCurtainText}>
            {building.id === "medical-college"
              ? assetState === "failed"
                ? "医学院 / 场景读取失败，请刷新后重试"
                : "医学院 / 黑暗中有什么正在显现"
              : assetState === "failed"
                ? "白沙宿舍 / 场景读取失败，请刷新后重试"
                : "白沙宿舍 / 正在适应黑暗"}
          </span>
        </div>
      )}

      {/* 氛围叠层：暗角 + 轻微冷调，与外层地图的恐怖质感统一。 */}
      <div style={styles.vignette} aria-hidden="true" />
      <div style={styles.scanline} aria-hidden="true" />
      <div
        aria-hidden="true"
        style={{
          ...styles.lightningFlash,
          background: currentSceneId === "medical_garage" ? "#ffffff" : styles.lightningFlash.background,
          opacity: lightningFlash ? (currentSceneId === "medical_garage" ? 1 : 0.78) : 0,
        }}
      />

      <BaishaDormExperience
        active={building.id === "dorm-baisha"}
        engineRef={engineRef}
        trigger={baishaTrigger}
        onTriggerHandled={() => setBaishaTrigger(null)}
        onStageChange={setBaishaStage}
      />

      <MedicalTopExperience
        active={building.id === "medical-college" && Boolean(medicalTopSnapshot)}
        engineRef={engineRef}
        snapshot={medicalTopSnapshot}
        modal={medicalTopModal}
        onModalClosed={() => setMedicalTopModal(null)}
      />

      <MedicalGarageExperience
        active={building.id === "medical-college" && currentSceneId === "medical_garage"}
        engineRef={engineRef}
        snapshot={medicalGarageSnapshot}
        modal={medicalGarageModal}
        onModalClosed={() => setMedicalGarageModal(null)}
      />

      <MedicalBasementExperience
        active={building.id === "medical-college" && currentSceneId === "medical_vault"}
        engineRef={engineRef}
        snapshot={medicalBasementSnapshot}
        modal={medicalBasementModal}
        onModalClosed={() => setMedicalBasementModal(null)}
      />

      {building.id === "medical-college" && medicalTopSnapshot && (
        <>
          <aside style={styles.inventoryRail} aria-label="医学院道具栏">
            <strong style={styles.sideRailTitle}>道具</strong>
            {([
              ["sedative", "蓝色镇静剂", "药", medicalTopSnapshot.sedativeShield, "可抵消一次致命违规"],
              ["fuse", "备用保险丝", "电", medicalTopSnapshot.hasFuse, "延缓走廊熄灯"],
            ] as const).map(([id, label, icon, owned, detail]) => (
              <div key={id} style={{ ...styles.inventorySlot, ...(owned ? styles.inventorySlotOwned : undefined) }}>
                <i style={styles.inventoryIcon}>{owned ? icon : "·"}</i>
                <span>
                  {label}
                  {owned && <small style={styles.inventorySlotStatus}>{detail}</small>}
                </span>
              </div>
            ))}
          </aside>
          <aside style={{ ...styles.storyChain, ...styles.medicalStoryChain }} aria-label="医学院顶层剧情链">
            <strong style={styles.sideRailTitle}>剧情链</strong>
            {MEDICAL_TOP_STEPS.map((label, index) => {
              const state = medicalTopStepState(medicalTopSnapshot, index);
              return (
                <div
                  key={label}
                  style={{
                    ...styles.storyStep,
                    ...(state.complete ? styles.storyStepComplete : undefined),
                    ...(state.active ? styles.storyStepActive : undefined),
                  }}
                >
                  <i style={styles.storyStepDot} />
                  <span>{label}</span>
                </div>
              );
            })}
          </aside>
        </>
      )}

      {building.id === "medical-college" && medicalGarageSnapshot && (
        <>
          <aside style={styles.inventoryRail} aria-label="地下车库道具栏">
            <strong style={styles.sideRailTitle}>道具</strong>
            <div style={{ ...styles.inventorySlot, ...(medicalGarageSnapshot.hasCandle ? styles.inventorySlotOwned : undefined) }}>
              <i style={styles.inventoryIcon}>{medicalGarageSnapshot.hasCandle ? "烛" : "·"}</i>
              <span>
                封印蜡烛
                {medicalGarageSnapshot.hasCandle && <small style={styles.inventorySlotStatus}>阵眼所需</small>}
              </span>
            </div>
          </aside>
          <aside style={{ ...styles.storyChain, ...styles.medicalStoryChain }} aria-label="地下车库剧情链">
            <strong style={styles.sideRailTitle}>剧情链</strong>
            {MEDICAL_GARAGE_STEPS.map((label, index) => {
              const state = medicalGarageStepState(medicalGarageSnapshot, index);
              return (
                <div key={label} style={{
                  ...styles.storyStep,
                  ...(state.complete ? styles.storyStepComplete : undefined),
                  ...(state.active ? styles.storyStepActive : undefined),
                }}>
                  <i style={styles.storyStepDot} />
                  <span>{label}</span>
                </div>
              );
            })}
          </aside>
        </>
      )}

      {building.id === "medical-college" && medicalBasementSnapshot && (
        <>
          <aside style={styles.inventoryRail} aria-label="地下仓库道具栏">
            <strong style={styles.sideRailTitle}>道具</strong>
            <div style={{ ...styles.inventorySlot, ...(medicalBasementSnapshot.hasFeather ? styles.inventorySlotOwned : undefined) }}>
              <i style={styles.inventoryIcon}>{medicalBasementSnapshot.hasFeather ? "羽" : "·"}</i>
              <span>
                猫头鹰羽毛
                {medicalBasementSnapshot.hasFeather && <small style={styles.inventorySlotStatus}>固定变化中的档案文字</small>}
              </span>
            </div>
          </aside>
          <aside style={{ ...styles.storyChain, ...styles.medicalStoryChain }} aria-label="地下仓库剧情链">
            <strong style={styles.sideRailTitle}>剧情链</strong>
            {MEDICAL_BASEMENT_STEPS.map((label, index) => {
              const state = medicalBasementStepState(medicalBasementSnapshot, index);
              return (
                <div key={label} style={{
                  ...styles.storyStep,
                  ...(state.complete ? styles.storyStepComplete : undefined),
                  ...(state.active ? styles.storyStepActive : undefined),
                }}>
                  <i style={styles.storyStepDot} />
                  <span>{label}</span>
                </div>
              );
            })}
          </aside>
        </>
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

      {/* Top-right authored floor plan. Hidden story/scare points are never previewed. */}
      {(building.id === "medical-library" || building.id === "dorm-baisha" || building.id === "medical-college") && (
        <div
          style={{
            ...styles.floorPlan,
            ...(building.id === "medical-college" ? styles.medicalFloorPlan : undefined),
          }}
          aria-label={`${building.name}平面图`}
        >
          <div style={styles.floorPlanTitle}>
            <strong>
              {building.id === "medical-library"
                ? "农医馆"
                : building.id === "dorm-baisha"
                  ? "白沙宿舍"
                  : "医学院"}
            </strong>
            <span>{building.id === "medical-college" ? "当前层平面图" : "平面图"}</span>
          </div>
          <canvas
            ref={floorPlanRef}
            style={{
              ...styles.floorPlanCanvas,
              ...(building.id === "medical-college" ? styles.medicalFloorPlanCanvas : undefined),
            }}
          />
          <div style={styles.floorPlanLegend}>
            <span><i style={{ ...styles.legendSwatch, background: "#d2dce0" }} />墙体</span>
            <span><i style={{ ...styles.legendSwatch, background: "#a68b5a" }} />
              {building.id === "medical-library" ? "书架" : building.id === "medical-college" ? "障碍" : "家具"}
            </span>
            <span><i style={styles.legendDot} />你</span>
          </div>
        </div>
      )}
      {building.id === "medical-library" && (
        <>
          <aside style={styles.inventoryRail} aria-label="场景道具栏">
            <strong style={styles.sideRailTitle}>道具</strong>
            {([
              ["flashlight", "手电筒", "光"],
              ["receipt", "借阅小票", "票"],
              ["talisman", "符咒", "符"],
            ] as const).map(([id, label, icon]) => {
              const owned = inventory.includes(id);
              return (
                <div key={id} style={{ ...styles.inventorySlot, ...(owned ? styles.inventorySlotOwned : undefined) }}>
                  <i style={styles.inventoryIcon}>{owned ? icon : "·"}</i>
                  <span>{label}</span>
                </div>
              );
            })}
          </aside>
          <aside style={styles.storyChain} aria-label="剧情链">
            <strong style={styles.sideRailTitle}>剧情链</strong>
            {LIBRARY_STEPS.map((label, index) => {
              const progress = libraryProgressIndex(currentSceneId, inventory);
              const complete = index < progress;
              const active = index === progress;
              return (
                <div
                  key={label}
                  style={{
                    ...styles.storyStep,
                    ...(complete ? styles.storyStepComplete : undefined),
                    ...(active ? styles.storyStepActive : undefined),
                  }}
                >
                  <i style={styles.storyStepDot} />
                  <span>{label}</span>
                </div>
              );
            })}
          </aside>
        </>
      )}
      {building.id === "dorm-baisha" && (
        <>
          <aside style={styles.inventoryRail} aria-label="场景道具栏">
            <strong style={styles.sideRailTitle}>道具</strong>
            {([
              ["flashlight", "手电筒", "光"],
              ["receipt", "借阅小票", "票"],
              ["talisman", "符纸", "符"],
              ...((baishaChaseStarted || baishaEnergyBoost)
                ? [["energy", "能量饮料", "饮"] as const]
                : []),
            ] as const).map(([id, label, icon]) => {
              const owned = id === "energy" ? baishaEnergyBoost : inventory.includes(id);
              return (
                <div key={id} style={{ ...styles.inventorySlot, ...(owned ? styles.inventorySlotOwned : undefined) }}>
                  <i style={styles.inventoryIcon}>{owned ? icon : "·"}</i>
                  <span>
                    {label}
                    {id === "energy" && owned && <small style={styles.inventorySlotStatus}>加速中</small>}
                  </span>
                </div>
              );
            })}
          </aside>
          <aside style={styles.storyChain} aria-label="剧情链">
            <strong style={styles.sideRailTitle}>剧情链</strong>
            {BAISHA_STEPS.map((label, index) => {
              const progress = baishaProgressIndex(baishaStage);
              const complete = index < progress;
              const active = index === progress;
              return (
                <div
                  key={label}
                  style={{
                    ...styles.storyStep,
                    ...(complete ? styles.storyStepComplete : undefined),
                    ...(active ? styles.storyStepActive : undefined),
                  }}
                >
                  <i style={styles.storyStepDot} />
                  <span>{label}</span>
                </div>
              );
            })}
          </aside>
        </>
      )}
      {building.id !== "medical-library" && building.id !== "dorm-baisha" && building.id !== "medical-college" && (
        <button
          style={{
            ...styles.exitBtn,
            ...styles.exitBtnBelowMap,
            ...(building.id === "medical-college" ? styles.medicalExitBtnBelowMap : undefined),
            ...(canExit ? undefined : styles.exitBtnDisabled),
          }}
          onClick={handleExit}
          disabled={!canExit}
        >
          {canExit ? "离开建筑" : "寻找出口"}
        </button>
      )}

      {(scene01Debug || baishaGameplayDebug || medicalGameplayDebug) && (
        <button
          type="button"
          style={styles.debugTargetButton}
          aria-label="调试前往当前目标"
          onClick={() => setDebugMessage(
            (medicalGameplayDebug
              ? engineRef.current?.debugTeleportToMedicalTarget()
              : baishaGameplayDebug
              ? engineRef.current?.debugTeleportToBaishaTarget()
              : engineRef.current?.debugTeleportToActiveTarget())
              ?? "场景仍在加载",
          )}
        >
          调试：前往当前目标
          {debugMessage && <small style={styles.debugTargetMessage}>{debugMessage}</small>}
        </button>
      )}

      {/* Building label. */}
      <div style={styles.title}>{building.id === "medical-library" ? "农医馆" : building.name}</div>

      {/* Pickup toast. */}
      {pickupToast && (
        <div style={styles.pickupToast}>
          <span>拾取</span>
          <strong>{pickupToast.name}</strong>
          {pickupToast.detail && <small style={styles.pickupToastDetail}>{pickupToast.detail}</small>}
        </div>
      )}

      {doorMessage && <div style={styles.doorMessage}>{doorMessage}</div>}
      {doorHint && <div style={styles.doorHint}>{doorHint}</div>}

      {/* Bottom control hint. */}
      <div style={styles.hint}>
        {isMobile
          ? "左下摇杆移动 · 右侧拖动看视角 · 右上角离开"
          : "点击画面锁定鼠标 · WASD/方向键移动 · E 交互 · 移动鼠标转视角 · Esc 释放"}
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
          onLostPointerCapture={resetJoystick}
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
  hostBlocked: {
    visibility: "hidden",
  },
  assetCurtain: {
    position: "absolute",
    inset: 0,
    zIndex: 20,
    display: "grid",
    placeItems: "center",
    pointerEvents: "auto",
    background:
      "radial-gradient(circle at 50% 46%, rgba(71, 4, 10, 0.12), transparent 42%), rgba(0, 0, 0, 0.985)",
  },
  assetCurtainText: {
    color: "rgba(223, 202, 192, 0.58)",
    fontSize: 12,
    letterSpacing: "0.28em",
    animation: "baishaLoadingPulse 1.8s ease-in-out infinite",
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
  exitBtnDisabled: {
    cursor: "not-allowed",
    opacity: 0.52,
  },
  lightningFlash: {
    position: "absolute",
    inset: 0,
    zIndex: 4,
    pointerEvents: "none",
    background: "rgba(236, 244, 255, 0.94)",
    mixBlendMode: "screen",
    transition: "opacity 32ms linear",
  },
  exitBtnBelowMap: {
    top: 344,
  },
  floorPlan: {
    position: "absolute",
    top: 14,
    right: 14,
    zIndex: 5,
    width: 178,
    height: 312,
    boxSizing: "border-box",
    padding: "10px 11px 9px",
    border: "1px solid rgba(196, 207, 210, 0.38)",
    borderRadius: 10,
    background: "rgba(5, 8, 11, 0.78)",
    boxShadow: "0 12px 30px rgba(0,0,0,0.48)",
    backdropFilter: "blur(7px)",
    pointerEvents: "none",
  },
  floorPlanTitle: {
    height: 25,
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    color: "#d8ddd9",
    letterSpacing: "0.08em",
    fontSize: 11,
  },
  floorPlanCanvas: {
    display: "block",
    width: 154,
    height: 250,
  },
  medicalFloorPlan: {
    width: 304,
    height: 212,
  },
  medicalFloorPlanCanvas: {
    width: 280,
    height: 150,
  },
  medicalExitBtnBelowMap: {
    top: 244,
  },
  floorPlanLegend: {
    height: 17,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    color: "rgba(200, 207, 207, 0.72)",
    fontSize: 9,
  },
  inventoryRail: {
    position: "absolute",
    top: 92,
    left: 20,
    zIndex: 5,
    width: 138,
    display: "grid",
    gap: 7,
    padding: "13px 12px",
    border: "1px solid rgba(182, 24, 33, 0.32)",
    background: "linear-gradient(180deg, rgba(8,7,9,0.82), rgba(8,6,8,0.58))",
    boxShadow: "0 14px 34px rgba(0,0,0,0.45)",
    backdropFilter: "blur(7px)",
  },
  sideRailTitle: {
    display: "block",
    marginBottom: 4,
    color: "rgba(221, 197, 158, 0.78)",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.22em",
  },
  inventorySlot: {
    display: "grid",
    gridTemplateColumns: "26px 1fr",
    alignItems: "center",
    minHeight: 34,
    color: "rgba(156, 148, 142, 0.35)",
    fontSize: 11,
    letterSpacing: "0.05em",
  },
  inventorySlotOwned: {
    color: "rgba(238, 221, 197, 0.9)",
  },
  inventoryIcon: {
    display: "grid",
    placeItems: "center",
    width: 22,
    height: 22,
    border: "1px solid currentColor",
    color: "inherit",
    fontSize: 11,
    fontStyle: "normal",
    boxShadow: "0 0 12px rgba(179, 19, 30, 0.16)",
  },
  inventorySlotStatus: {
    display: "block",
    marginTop: 2,
    color: "rgba(236, 94, 72, 0.9)",
    fontSize: 9,
    letterSpacing: "0.12em",
  },
  storyChain: {
    position: "absolute",
    top: 344,
    right: 14,
    zIndex: 5,
    width: 178,
    boxSizing: "border-box",
    display: "grid",
    gap: 0,
    padding: "12px 13px 13px",
    border: "1px solid rgba(196, 207, 210, 0.26)",
    background: "rgba(5, 8, 11, 0.78)",
    boxShadow: "0 12px 30px rgba(0,0,0,0.48)",
    backdropFilter: "blur(7px)",
  },
  medicalStoryChain: {
    top: 244,
    width: 196,
  },
  storyStep: {
    position: "relative",
    display: "grid",
    gridTemplateColumns: "14px 1fr",
    alignItems: "center",
    minHeight: 30,
    color: "rgba(163, 164, 161, 0.3)",
    fontSize: 10.5,
    letterSpacing: "0.05em",
  },
  storyStepComplete: {
    color: "rgba(183, 157, 124, 0.62)",
  },
  storyStepActive: {
    color: "#f0d8b4",
    textShadow: "0 0 11px rgba(213, 20, 31, 0.62)",
  },
  storyStepDot: {
    display: "block",
    width: 5,
    height: 5,
    borderRadius: "50%",
    background: "currentColor",
    boxShadow: "0 0 7px currentColor",
  },
  legendSwatch: {
    display: "inline-block",
    width: 7,
    height: 7,
    marginRight: 3,
  },
  legendDot: {
    display: "inline-block",
    width: 6,
    height: 6,
    marginRight: 3,
    borderRadius: "50%",
    background: "#fff",
    boxShadow: "0 0 5px #fff",
  },
  title: {
    position: "absolute",
    top: 20,
    left: 22,
    zIndex: 5,
    color: "#d7b776",
    fontSize: 20,
    fontWeight: 700,
    letterSpacing: "0.18em",
    textShadow: "0 0 10px rgba(0,0,0,0.95)",
    pointerEvents: "none",
  },
  debugTargetButton: {
    position: "absolute",
    left: 20,
    bottom: 56,
    zIndex: 9,
    display: "grid",
    gap: 3,
    minWidth: 150,
    padding: "8px 10px",
    border: "1px solid rgba(230, 45, 56, 0.7)",
    borderRadius: 0,
    background: "rgba(24, 5, 8, 0.9)",
    color: "#f2c3aa",
    fontFamily: FONT_STACK,
    fontSize: 11,
    cursor: "pointer",
  },
  debugTargetMessage: {
    color: "rgba(240, 194, 166, 0.66)",
    fontSize: 9,
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
  doorHint: {
    position: "absolute",
    bottom: 58,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 6,
    padding: "8px 16px",
    borderRadius: 7,
    background: "rgba(10,8,8,0.82)",
    border: "1px solid rgba(215,183,118,0.5)",
    color: "#f3d79a",
    fontSize: 14,
    letterSpacing: "0.08em",
    pointerEvents: "none",
    whiteSpace: "nowrap",
  },
  doorMessage: {
    position: "absolute",
    top: 76,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 7,
    padding: "9px 18px",
    borderRadius: 8,
    background: "rgba(21,15,15,0.9)",
    border: "1px solid rgba(179,50,46,0.65)",
    color: "#f0c98a",
    fontSize: 14,
    letterSpacing: "0.08em",
    pointerEvents: "none",
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
  pickupToastDetail: {
    color: "rgba(240, 111, 82, 0.92)",
    fontSize: 11,
    letterSpacing: "0.08em",
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
