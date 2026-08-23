import * as THREE from "three";
import { buildRoom, classifyRoom, type AABB, type InteriorGuideNode, type RoomBuildResult, type RoomKind } from "./buildRoom";
import { getInteriorBlueprint, type InteriorBlueprint } from "./interiorBlueprints";
import {
  createMovementContext,
  MovementStateMachine,
  IdleState,
  WalkState,
  RunState,
  JumpState,
  InAirState,
  CrouchState,
  type MovementContext,
} from "./stateMachine";
import { InputManager } from "./InputManager";
import { CameraController } from "./CameraController";
import { FlashlightSystem } from "./FlashlightSystem";
import { getInteriorNpcRevealSceneIds } from "../storyEngine";
import { loadInteriorAsset, type InteriorAssetHandle } from "./InteriorAssetLoader";
import type { InteriorCollisionMap, InteriorMapObstacle } from "./InteriorCollisionMap";
import { playLibraryThunder, startLibraryStorm, stopLibraryStorm } from "../audio/proceduralAudio";

export type InteriorAssetState = "loading" | "ready" | "failed";

export interface InteriorMapSnapshot {
  bounds: InteriorCollisionMap["bounds"];
  obstacles: InteriorMapObstacle[];
  player: { x: number; z: number };
  objective?: { x: number; z: number };
  fallenPerson?: { x: number; z: number };
  exitSegment?: { minX: number; maxX: number; z: number };
}

export interface Interior3DOptions {
  /** Element the WebGL canvas is appended into. Sized to fill it. */
  container: HTMLElement;
  buildingId: string;
  zone?: string;
  /** Mobile skips pointer-lock / mouse look; input arrives via methods. */
  isMobile?: boolean;
  /** Called once when the player walks over a collectable item. */
  onPickup?: (itemId: string, name: string) => void;
  /** Called when the player walks into a story-trigger zone inside the 3D interior. */
  onStoryTrigger?: (sceneId: string) => void;
  /** Called when the player walks into an interior exit trigger. */
  onExitTrigger?: () => void;
  /** Current story scene id; drives which interior triggers/items are active. */
  getStorySceneId?: () => string;
  /** Current player inventory; drives persistent equipment such as the flashlight. */
  getInventory?: () => string[];
  /** Current stamina 0-100 (read from story state). */
  getStamina?: () => number;
  /** Persist stamina back to story state. */
  setStamina?: (value: number) => void;
  /** Current player inventory for door key checks. */
  getDoorInventory?: () => string[];
  /** Reports when authored static visuals are safe to reveal. */
  onAssetStateChange?: (state: InteriorAssetState) => void;
}

const DEFAULT_PLAYER_RADIUS = 0.32;
const AUTHORED_LIBRARY_PLAYER_RADIUS = 0.22;
const EYE_HEIGHT = 1.6;
const GUIDE_MAX_POINTS = 32;
const EMPTY_INVENTORY: string[] = [];
const STAMINA_STORE_SYNC_INTERVAL = 0.1;
/** Pickups retain their authored automatic proximity radius. */
const PICKUP_AUTO_RADIUS_SCALE = 1;
/** Story and exit triggers receive a restrained 10% automatic proximity margin. */
const STORY_AUTO_RADIUS_SCALE = 1.1;
/** Pressing E grants a wider margin without changing the authored radius stored in scene metadata. */
const MANUAL_INTERACTION_RADIUS_SCALE = 1.25;

/**
 * Self-contained first-person interior renderer. Owns its renderer, scene,
 * camera, animation loop and (on desktop) input listeners. Mobile input is
 * pushed in through `setMoveInput` / `addLook`.
 *
 * Movement logic is delegated to a state machine (MovementStateMachine),
 * input to InputManager, and camera rotation / FOV to CameraController.
 */
export class Interior3D {
  private readonly container: HTMLElement;
  private readonly isMobile: boolean;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly clock = new THREE.Clock();

  private readonly flashlight: THREE.SpotLight;
  private readonly flashTarget: THREE.Object3D;
  private readonly flashlightSys: FlashlightSystem;
  private readonly ambientLight: THREE.AmbientLight;
  private readonly fillLight: THREE.HemisphereLight;
  private readonly nearFillLight: THREE.PointLight;
  private readonly bloodLight: THREE.PointLight;
  private readonly outsideRedLight: THREE.PointLight;
  private readonly outsideWhiteLight: THREE.PointLight;
  private readonly outsideCeilingLight: THREE.RectAreaLight;

  private room: RoomBuildResult;
  private readonly roomKind: RoomKind;
  private colliders: AABB[];
  private staticColliderSet = false;
  private bounds: AABB;
  private playerRadius = DEFAULT_PLAYER_RADIUS;
  private readonly blueprint: InteriorBlueprint;
  private assetHandle?: InteriorAssetHandle;
  private readonly assetPickupVisuals = new Map<string, THREE.Object3D[]>();
  private readonly assetStoryVisuals = new Map<string, THREE.Object3D[]>();
  private readonly pickupsByItemId = new Map<string, RoomBuildResult["pickups"][number]>();
  private readonly storyTriggersBySceneId = new Map<string, RoomBuildResult["storyTriggers"][number]>();
  private readonly targetGlowLights = new Map<string, THREE.PointLight>();
  private readonly assetPhaseVisuals: Array<{ objects: THREE.Object3D[]; activeSceneIds: string[] }> = [];
  private readonly assetFlickerLights: Array<{
    light: THREE.PointLight;
    baseIntensity: number;
    speed: number;
    phase: number;
    y: number;
    followPickupId?: string;
    followPickup?: RoomBuildResult["pickups"][number];
  }> = [];
  private readonly assetCeilingLights: THREE.PointLight[] = [];
  private readonly onPickup?: (itemId: string, name: string) => void;
  private readonly onStoryTrigger?: (sceneId: string) => void;
  private readonly onExitTrigger?: () => void;
  private readonly getStorySceneId?: () => string;
  private readonly getInventory?: () => string[];
  private readonly getStamina?: () => number;
  private readonly setStamina?: (value: number) => void;
  private readonly onAssetStateChange?: (state: InteriorAssetState) => void;
  private runtimeStamina = 100;
  private persistedStamina = 100;
  private staminaStoreSyncElapsed = 0;
  private storySceneId?: string;
  private inventorySnapshot: string[] = EMPTY_INVENTORY;
  private readonly inventoryItems = new Set<string>();
  private storyPhaseDirty = true;
  private interiorMapObstacles?: InteriorMapObstacle[];
  private lowStaminaWarning = false;
  private fallenLinwei?: THREE.Object3D;
  private fallSpotlight?: THREE.SpotLight;
  private fallBodyFill?: THREE.PointLight;
  private fallSpotlightTarget?: THREE.Object3D;
  private fallRevealed = false;
  private hasLeftShelfAfterFall = false;
  private libraryReturnFlicker = false;
  private debugFallStaged = false;
  private bloodLightEnabled = false;
  private bloodLightMaxIntensity = 4.8;
  private nextBloodFlashAt = 0;
  private bloodFlashUntil = 0;
  private libraryStormActive = false;
  private nextLightningAt = Number.POSITIVE_INFINITY;
  private lightningFlashUntil = 0;

  // ── New movement architecture ──
  private readonly inputManager: InputManager;
  private readonly cameraController: CameraController;
  private readonly stateMachine: MovementStateMachine;
  private readonly moveCtx: MovementContext;
  /** CrouchState reference kept to read the lerped eye height. */
  private readonly crouchState: CrouchState;

  private debugColliders?: THREE.Group;
  private guideLine?: THREE.Line;
  private suppressLegacyGuidance = false;

  private rafId = 0;
  private disposed = false;
  private pointerLocked = false;
  private readonly perfEnabled: boolean;
  private perfWindowStartedAt = 0;
  private perfLastFrameAt = 0;
  private readonly perfFrameTimes: number[] = [];
  private perfStaminaWrites = 0;
  private perfCollisionCalls = 0;
  private perfPenetrationScans = 0;

  // Bound handlers (kept so they can be removed on dispose).
  private readonly onResize = () => this.resize();
  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.code === "F3") { e.preventDefault(); this.toggleColliderDebug(); return; }
    if (e.code === "KeyE") { e.preventDefault(); this.ePressed = true; return; }
    this.inputManager.handleKeyDown(e);
  };
  private readonly onKeyUp = (e: KeyboardEvent) => this.inputManager.handleKeyUp(e);
  private readonly resetInput = () => {
    this.inputManager.reset();
    this.moveCtx.velocity.x = 0;
    this.moveCtx.velocity.y = 0;
  };
  private readonly onVisibilityChange = () => {
    if (document.hidden) this.resetInput();
  };
  private readonly onMouseMove = (e: MouseEvent) => this.handleMouseMove(e);
  private readonly onPointerLockChange = () => {
    this.pointerLocked = document.pointerLockElement === this.renderer.domElement;
    if (!this.pointerLocked) this.resetInput();
  };
  private readonly onCanvasClick = () => {
    if (!this.isMobile && !this.pointerLocked) this.requestPointerLock();
  };

  constructor(options: Interior3DOptions) {
    this.container = options.container;
    this.isMobile = options.isMobile ?? false;
    this.onPickup = options.onPickup;
    this.onStoryTrigger = options.onStoryTrigger;
    this.onExitTrigger = options.onExitTrigger;
    this.getStorySceneId = options.getStorySceneId;
    this.getInventory = options.getInventory;
    this.getStamina = options.getStamina;
    this.setStamina = options.setStamina;
    this.onAssetStateChange = options.onAssetStateChange;
    this.perfEnabled = new URLSearchParams(window.location.search).get("perfInterior") === "1";
    this.runtimeStamina = this.clampStamina(this.getStamina?.() ?? 100);
    this.persistedStamina = Math.round(this.runtimeStamina);
    this.refreshSharedState();

    // ---- Renderer ----
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isMobile,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.68;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.isMobile ? 1.5 : 2));
    if (!this.isMobile) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.renderer.domElement.style.touchAction = "none";
    this.container.appendChild(this.renderer.domElement);

    // ---- Scene + atmosphere ----
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x080b12);
    // 放宽雾(近 3→4，远 16→30)，让房间结构在中景可辨，不再一片死黑。
    this.scene.fog = new THREE.Fog(0x080b12, 4, 30);

    // ---- Camera ----
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.05, 100);
    this.camera.position.set(0, EYE_HEIGHT, 0);
    this.scene.add(this.camera);

    // ---- Lights ----
    // 略微抬高环境光/半球光,让房间整体不再纯黑(仍保留昏暗恐怖基调)。
    this.ambientLight = new THREE.AmbientLight(0x2a3038, 0.85);
    this.scene.add(this.ambientLight);
    this.fillLight = new THREE.HemisphereLight(0x28303c, 0x0a0c10, 0.55);
    this.scene.add(this.fillLight);

    // 近距离补光:跟随相机的一盏很弱、短射程点光,只照亮角色周围、脚下和近处墙壁。
    this.nearFillLight = new THREE.PointLight(0xaeb6c6, 0.85, 5.0, 2.0);
    this.nearFillLight.position.set(0, -0.2, 0.1);
    this.camera.add(this.nearFillLight);

    this.bloodLight = new THREE.PointLight(0x6a0505, 0, 13, 2.2);
    this.bloodLight.position.set(-1.25, 3.05, -4.75);
    this.scene.add(this.bloodLight);
    this.scheduleBloodFlash(0);
    this.outsideRedLight = new THREE.PointLight(0x71030a, 0, 20, 1.55);
    this.outsideRedLight.position.set(2.4, 1.25, 34.5);
    this.scene.add(this.outsideRedLight);

    // A dim, cold wash keeps the exterior yard navigable before the fall
    // reveal without exposing the hidden body or competing with the red lamp.
    this.outsideWhiteLight = new THREE.PointLight(0xdbe5f2, 0, 29, 1.45);
    this.outsideWhiteLight.position.set(1.8, 4.2, 32.5);
    this.scene.add(this.outsideWhiteLight);
    // Invisible ceiling-sized source: reads as storm light leaking down from
    // above, without adding a visible lamp model to the authored courtyard.
    this.outsideCeilingLight = new THREE.RectAreaLight(0xe7efff, 0, 17, 43);
    this.outsideCeilingLight.position.set(4.3, 8.2, 36.5);
    this.outsideCeilingLight.lookAt(4.3, 0, 36.5);
    this.scene.add(this.outsideCeilingLight);

    // Flashlight follows the camera.
    this.flashlight = new THREE.SpotLight(0xfff2d0, 8.6, 23, Math.PI / 5.6, 0.42, 1.35);
    this.flashlight.position.set(0, 0, 0);
    if (!this.isMobile) {
      this.flashlight.castShadow = true;
      this.flashlight.shadow.mapSize.set(1024, 1024);
      this.flashlight.shadow.camera.near = 0.2;
      this.flashlight.shadow.camera.far = 20;
    }
    this.camera.add(this.flashlight);
    this.flashTarget = new THREE.Object3D();
    this.flashTarget.position.set(0, 0, -1);
    this.camera.add(this.flashTarget);
    this.flashlight.target = this.flashTarget;

    // ── Flashlight battery system ──
    this.flashlightSys = new FlashlightSystem(this.flashlight);

    // ---- Room ----
    this.roomKind = classifyRoom(options.buildingId, options.zone);
    this.bloodLightEnabled = this.roomKind === "library";
    this.outsideRedLight.intensity = 0;
    this.outsideWhiteLight.intensity = this.roomKind === "library" ? 2.8 : 0;
    this.blueprint = getInteriorBlueprint(this.roomKind);
    this.room = buildRoom(this.roomKind);
    for (const pickup of this.room.pickups) this.pickupsByItemId.set(pickup.itemId, pickup);
    for (const trigger of this.room.storyTriggers) this.storyTriggersBySceneId.set(trigger.sceneId, trigger);
    this.scene.add(this.room.root);
    this.colliders = this.room.colliders;
    this.bounds = this.room.bounds;
    this.loadStaticInteriorAsset(options.buildingId);

    // Spawn at the room's entrance, looking down the corridor (-Z).
    this.camera.position.copy(this.findClearSpawn(this.room.spawn));

    // ── Initialise movement systems ──
    this.inputManager = new InputManager();
    this.cameraController = new CameraController(this.camera, this.isMobile);
    this.cameraController.setYaw(this.blueprint.spawnYaw);

    this.moveCtx = createMovementContext(this.camera, this.blueprint.movement, {
      collidesAt: (x, _y, z) => this.collides(x, z),
      bounds: this.bounds,
      playerRadius: this.playerRadius,
      floorHeightAt: (x, z) => this.room.floorHeightAt(x, z),
    });

    this.stateMachine = new MovementStateMachine();
    this.stateMachine.register(new IdleState());
    this.stateMachine.register(new WalkState());
    this.stateMachine.register(new RunState());
    this.stateMachine.register(new JumpState());
    this.stateMachine.register(new InAirState());
    this.crouchState = new CrouchState();
    this.stateMachine.register(this.crouchState);
    this.stateMachine.start("idle", this.moveCtx);

    if (new URLSearchParams(window.location.search).has("debugInterior")) this.toggleColliderDebug();

    // Create dashed guide line on floor to active story trigger
    this.createGuideLine();
    this.syncStoryPhase();

    this.resize();
  }

  /** Begin listeners + render loop. */
  start(): void {
    window.addEventListener("resize", this.onResize);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.resetInput);
    window.addEventListener("pagehide", this.resetInput);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    if (!this.isMobile) {
      document.addEventListener("mousemove", this.onMouseMove);
      document.addEventListener("pointerlockchange", this.onPointerLockChange);
      this.renderer.domElement.addEventListener("click", this.onCanvasClick);
    }
    this.clock.start();
    this.loop();
  }

  // ---- Public input API (used by the React overlay on mobile) ----

  /** Set movement intent. x = strafe (-1 left..1 right), y = forward (1)/back (-1). */
  setMoveInput(x: number, y: number): void {
    this.inputManager.setVirtualMove(
      THREE.MathUtils.clamp(x, -1, 1),
      THREE.MathUtils.clamp(y, -1, 1),
    );
  }

  /** Apply a look delta (pixels). Used by touch drag. */
  addLook(dx: number, dy: number): void {
    this.cameraController.addTouchLook(dx, dy);
  }

  /** Restore flashlight battery (0…1).  Called when picking up a battery. */
  restoreFlashlightBattery(amount: number): void {
    this.flashlightSys.restore(amount);
  }

  /** Current flashlight battery level 0…1. */
  get flashlightBattery(): number {
    return this.flashlightSys.battery;
  }

  /** Live position plus the authored model's floor-plan obstacles. */
  getInteriorMapSnapshot(): InteriorMapSnapshot | null {
    const collisionMap = this.assetHandle?.collisionMap;
    if (!collisionMap || this.roomKind !== "library") return null;
    const sceneId = this.getStorySceneId?.();
    let objective: InteriorMapSnapshot["objective"];
    if (sceneId === "library_intro") {
      if (!this.hasInventoryItem("flashlight")) {
        const flashlight = this.pickupsByItemId.get("flashlight");
        if (flashlight && !flashlight.taken) objective = { x: flashlight.position.x, z: flashlight.position.z };
      } else {
        const trigger = this.storyTriggersBySceneId.get(sceneId);
        if (trigger && !trigger.triggered) objective = { x: trigger.position.x, z: trigger.position.z };
      }
    } else if (sceneId === "library_receipt" || sceneId === "library_talisman") {
      const itemId = sceneId === "library_receipt" ? "receipt" : "talisman";
      const pickup = this.pickupsByItemId.get(itemId);
      if (pickup && !pickup.taken) objective = { x: pickup.position.x, z: pickup.position.z };
    } else if (sceneId === "library_shelf") {
      const trigger = this.storyTriggersBySceneId.get(sceneId);
      if (trigger && !trigger.triggered) objective = { x: trigger.position.x, z: trigger.position.z };
    }
    const fallReveal = this.assetHandle?.meta?.fallReveal;
    return {
      bounds: collisionMap.bounds,
      obstacles: this.interiorMapObstacles ?? collisionMap.obstacles,
      player: { x: this.camera.position.x, z: this.camera.position.z },
      objective,
      fallenPerson: this.fallRevealed && fallReveal
        ? { x: fallReveal.body.x, z: fallReveal.body.z }
        : undefined,
      exitSegment: sceneId === "dorm_baiqiu" ? this.assetHandle?.meta?.exitSegment : undefined,
    };
  }

  /**
   * Development-only QA helper. The React overlay exposes this only when the
   * page is opened with ?debugScene01=1, so normal players never see it.
   * It still uses the real proximity collectors on the next animation frame.
   */
  debugTeleportToActiveTarget(): string {
    if (this.roomKind !== "library") return "当前场景没有调试目标";
    const sceneId = this.getStorySceneId?.();
    if (this.fallRevealed && sceneId === "library_fall" && this.assetHandle?.meta?.fallReveal) {
      const bodyBox = this.fallenLinwei ? new THREE.Box3().setFromObject(this.fallenLinwei) : null;
      const center = bodyBox && !bodyBox.isEmpty()
        ? bodyBox.getCenter(new THREE.Vector3())
        : new THREE.Vector3(
          this.assetHandle.meta.fallReveal.body.x,
          this.assetHandle.meta.fallReveal.body.y,
          this.assetHandle.meta.fallReveal.body.z,
        );
      const forward = this.camera.getWorldDirection(new THREE.Vector3());
      return `坠楼调试：镜头(${this.camera.position.x.toFixed(2)},${this.camera.position.y.toFixed(2)},${this.camera.position.z.toFixed(2)}) 人体(${center.x.toFixed(2)},${center.y.toFixed(2)},${center.z.toFixed(2)}) 朝向(${forward.x.toFixed(2)},${forward.y.toFixed(2)},${forward.z.toFixed(2)})`;
    }
    let target: THREE.Vector3 | undefined;
    let activationRadius = 1.2;
    let label = "当前目标";
    let lookAtFallBody: { x: number; z: number } | undefined;

    if (sceneId === "library_intro" && !this.hasInventoryItem("flashlight")) {
      const flashlight = this.pickupsByItemId.get("flashlight");
      target = flashlight && !flashlight.taken ? flashlight.position : undefined;
      activationRadius = flashlight?.radius ?? activationRadius;
      label = "手电筒";
    } else if (sceneId === "library_receipt" || sceneId === "library_talisman") {
      const itemId = sceneId === "library_receipt" ? "receipt" : "talisman";
      const pickup = this.pickupsByItemId.get(itemId);
      target = pickup && !pickup.taken ? pickup.position : undefined;
      activationRadius = pickup?.radius ?? activationRadius;
      label = itemId === "receipt" ? "借阅小票" : "符咒";
    } else if (sceneId === "library_fall" && this.assetHandle?.meta?.fallReveal) {
      const reveal = this.assetHandle.meta.fallReveal;
      const stagingDistance = (reveal.triggerDistance ?? 8.75) + 1.35;
      const targetDistance = this.debugFallStaged ? (reveal.triggerDistance ?? 8.75) - 0.45 : stagingDistance;
      const approachX = Math.max(reveal.approachMinX ?? 0, reveal.body.x - 2.05) + 0.35;
      const dx = approachX - reveal.body.x;
      const dz = Math.sqrt(Math.max(0.5, targetDistance * targetDistance - dx * dx));
      target = new THREE.Vector3(approachX, reveal.body.y, reveal.body.z - dz);
      activationRadius = 0.45;
      label = this.debugFallStaged ? "跨入坠楼触发距离" : "坠楼触发距离外";
      this.debugFallStaged = !this.debugFallStaged;
      lookAtFallBody = reveal.body;
    } else {
      const trigger = this.room.storyTriggers.find(
        (item) => !item.triggered && this.isTriggerAvailable(item, sceneId),
      );
      target = trigger?.position;
      activationRadius = trigger?.radius ?? activationRadius;
      label = trigger?.action === "exit" ? "出口" : trigger?.sceneId ?? label;
    }

    if (!target) return "当前目标尚未激活";
    let safe: THREE.Vector3 | undefined;
    const radii = [0, activationRadius * 0.35, activationRadius * 0.62, activationRadius * 0.84];
    for (const radius of radii) {
      const steps = radius === 0 ? 1 : 24;
      for (let step = 0; step < steps; step++) {
        const angle = (Math.PI * 2 * step) / steps;
        const x = this.clampToBounds(target.x + Math.cos(angle) * radius, this.bounds.minX, this.bounds.maxX);
        const z = this.clampToBounds(target.z + Math.sin(angle) * radius, this.bounds.minZ, this.bounds.maxZ);
        if (!this.collides(x, z)) {
          safe = new THREE.Vector3(x, target.y, z);
          break;
        }
      }
      if (safe) break;
    }
    safe ??= this.findNearestClearPoint(target) ?? this.findNearestAssetClearPoint(target);
    const floor = this.room.floorHeightAt(safe.x, safe.z);
    this.camera.position.set(safe.x, floor + this.crouchState.eyeHeight, safe.z);
    this.resolvePenetration();
    if (lookAtFallBody) {
      const dx = lookAtFallBody.x - this.camera.position.x;
      const dz = lookAtFallBody.z - this.camera.position.z;
      this.cameraController.setLook(Math.atan2(-dx, -dz), -0.08);
    }
    return `已前往：${label}`;
  }

  /** Nearest door interaction hint text, or "" when nothing is in range. */
  get doorHint(): string {
    const door = this.findNearestDoor();
    if (!door) return "";
    return door.interactionLabel + " — 按 E";
  }

  // ── Door interaction ──

  private ePressed = false;

  private findNearestDoor(): import("./DoorComponent").DoorComponent | null {
    let best: import("./DoorComponent").DoorComponent | null = null;
    let bestDist = 2.5;
    const pos = this.camera.position;
    for (const door of this.room.doors) {
      const dist = pos.distanceTo(door.hinge);
      if (dist < bestDist) { bestDist = dist; best = door; }
    }
    return best;
  }

  private handleDoorInteraction(): void {
    if (!this.ePressed) return;
    this.ePressed = false;

    const door = this.findNearestDoor();
    if (!door) return;

    const inventory = this.getDoorInventory?.() ?? [];
    const msg = door.interact(this.camera.position, inventory, 2.5);
    if (msg) {
      window.dispatchEvent(new CustomEvent("zju-horror-door-message", { detail: { message: msg } }));
    }
  }

  /** Callback to read current story inventory. Set by InteriorOverlay. */
  getDoorInventory?: () => string[];

  requestPointerLock(): void {
    if (this.isMobile) return;
    const el = this.renderer.domElement;
    // requestPointerLock may return void or a Promise depending on the browser.
    const maybe = el.requestPointerLock() as unknown as Promise<void> | undefined;
    if (maybe && typeof maybe.catch === "function") maybe.catch(() => undefined);
  }

  exitPointerLock(): void {
    if (document.pointerLockElement === this.renderer.domElement) {
      document.exitPointerLock();
    }
  }

  /** Tear down everything: loop, listeners, GPU resources, pointer lock. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    cancelAnimationFrame(this.rafId);
    this.inputManager.reset();
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.resetInput);
    window.removeEventListener("pagehide", this.resetInput);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    this.renderer.domElement.removeEventListener("click", this.onCanvasClick);
    this.exitPointerLock();

    if (this.debugColliders) this.toggleColliderDebug();
    this.assetHandle?.dispose();
    this.assetHandle = undefined;
    this.assetPickupVisuals.clear();
    this.assetStoryVisuals.clear();
    this.assetPhaseVisuals.length = 0;
    for (const light of this.targetGlowLights.values()) this.scene.remove(light);
    this.targetGlowLights.clear();
    if (this.fallSpotlight) this.scene.remove(this.fallSpotlight);
    if (this.fallSpotlightTarget) this.scene.remove(this.fallSpotlightTarget);
    stopLibraryStorm();
    window.dispatchEvent(new CustomEvent("zju-horror-library-lightning", { detail: { active: false } }));
    this.clearAssetFlickerLights();
    this.clearAssetCeilingLights();
    this.room.dispose();
    this.scene.clear();

    this.renderer.dispose();
    const canvas = this.renderer.domElement;
    if (canvas.parentElement === this.container) {
      this.container.removeChild(canvas);
    }
  }

  // ---- Internals ----

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.pointerLocked) return;
    this.cameraController.addMouseLook(e.movementX, e.movementY);
  }

  private async loadStaticInteriorAsset(buildingId: string): Promise<void> {
    this.onAssetStateChange?.("loading");
    try {
      const handle = await loadInteriorAsset({
        buildingId,
        roomKind: this.roomKind,
        isMobile: this.isMobile,
      });
      if (!handle) {
        if (!this.disposed) this.onAssetStateChange?.("ready");
        return;
      }
      if (this.disposed) {
        handle.dispose();
        return;
      }

      this.assetHandle = handle;
      this.scene.add(handle.root);
      this.applyAssetPresentation(handle);
      this.bindInteriorAssetMetadata(handle);
      this.addAssetCeilingLights(handle);
      this.suppressLegacyGuidance = this.roomKind === "library" || !handle.meta;
      if (this.suppressLegacyGuidance) {
        this.bloodLightEnabled = false;
        this.bloodLight.intensity = 0;
        this.setProceduralStoryTriggerMarkersVisible(false);
        this.setProceduralPickupGuideLightsVisible(false);
        if (this.guideLine) this.guideLine.visible = false;
      }
      this.setProceduralRoomVisualsVisible(false);
      this.onAssetStateChange?.("ready");
      window.dispatchEvent(new CustomEvent("zju-horror-interior-asset-state", {
        detail: {
          buildingId,
          roomKind: this.roomKind,
          loaded: true,
          assetVersion: handle.meta?.assetVersion,
        },
      }));
    } catch (err) {
      if (this.disposed) return;
      console.warn("[Interior3D] Failed to load static interior asset, using procedural fallback:", err);
      this.setProceduralRoomVisualsVisible(true);
      this.onAssetStateChange?.("failed");
      window.dispatchEvent(new CustomEvent("zju-horror-interior-asset-state", {
        detail: { buildingId, roomKind: this.roomKind, loaded: false },
      }));
    }
  }

  private applyAssetPresentation(handle: InteriorAssetHandle): void {
    const assetBounds = handle.collisionMap.bounds;
    this.bounds.minX = assetBounds.minX;
    this.bounds.maxX = assetBounds.maxX;
    this.bounds.minZ = assetBounds.minZ;
    this.bounds.maxZ = assetBounds.maxZ;
    // The procedural room uses a different coordinate system. Once an
    // authored GLB is present, its projected meshes become collision truth.
    const clearZones = handle.meta?.navigationClearZones ?? [];
    this.colliders = handle.collisionMap.obstacles.filter((obstacle) => {
      const centerX = (obstacle.minX + obstacle.maxX) * 0.5;
      const centerZ = (obstacle.minZ + obstacle.maxZ) * 0.5;
      return !clearZones.some((zone) => (
        (!zone.kind || zone.kind === obstacle.kind)
        && centerX >= zone.minX
        && centerX <= zone.maxX
        && centerZ >= zone.minZ
        && centerZ <= zone.maxZ
      ));
    });
    this.staticColliderSet = this.colliders.every((collider) => (
      !collider.isActive && !collider.activeSceneIds?.length
    ));
    const hiddenBodyBounds = handle.meta?.fallReveal?.mapBounds;
    this.interiorMapObstacles = hiddenBodyBounds
      ? handle.collisionMap.obstacles.filter((obstacle) => (
        obstacle.maxX < hiddenBodyBounds.minX
        || obstacle.minX > hiddenBodyBounds.maxX
        || obstacle.maxZ < hiddenBodyBounds.minZ
        || obstacle.minZ > hiddenBodyBounds.maxZ
      ))
      : handle.collisionMap.obstacles;
    this.playerRadius = AUTHORED_LIBRARY_PLAYER_RADIUS;
    this.moveCtx.playerRadius = this.playerRadius;

    if (!handle.viewpoint) return;
    const requestedSpawn = new THREE.Vector3(handle.viewpoint.position.x, EYE_HEIGHT, handle.viewpoint.position.z);
    this.camera.position.copy(this.findNearestAssetClearPoint(requestedSpawn));
    // Saved DCC views often carry a steep presentation tilt. Preserve their
    // heading while keeping the playable first-person view near eye level.
    const playablePitch = THREE.MathUtils.clamp(handle.viewpoint.pitch, -0.4, 0.4);
    this.cameraController.setLook(handle.viewpoint.yaw, playablePitch);
  }

  private bindInteriorAssetMetadata(handle: InteriorAssetHandle): void {
    const redLight = handle.meta?.redLights?.[0];
    if (redLight) {
      this.bloodLight.position.set(redLight.x, redLight.y, redLight.z);
      this.bloodLight.color.setHex(redLight.color ?? 0x6a0505);
      this.bloodLight.distance = redLight.distance ?? 13;
      this.bloodLightMaxIntensity = redLight.intensity ?? 4.8;
    }

    this.assetPickupVisuals.clear();
    this.assetStoryVisuals.clear();
    this.assetPhaseVisuals.length = 0;
    this.clearAssetFlickerLights();
    this.applyAssetPickupSpots(handle);
    this.applyAssetStorySpots(handle);
    this.createAssetFlickerLights(handle);
    const pickupVisuals = handle.meta?.pickupVisuals ?? {};
    const storyVisuals = handle.meta?.storyVisuals ?? {};
    const phaseVisuals = handle.meta?.phaseVisuals ?? [];
    const visualNames = new Set([
      ...Object.values(pickupVisuals).flat(),
      ...Object.values(storyVisuals).flat(),
      ...phaseVisuals.flatMap((phaseVisual) => phaseVisual.names),
    ]);
    // Authored assets use light cast onto real props/books. The old floating
    // icosahedron/ring markers stay hidden while their parent zones continue
    // to drive proximity checks.
    this.setProceduralStoryTriggerMarkersVisible(!handle.meta);
    if (visualNames.size === 0) return;

    const matched = new Map<string, THREE.Object3D[]>();
    handle.root.traverse((obj) => {
      for (const visualName of visualNames) {
        if (obj.name === visualName || obj.name.startsWith(`${visualName}_`)) {
          const objects = matched.get(visualName) ?? [];
          objects.push(obj);
          matched.set(visualName, objects);
        }
      }
    });

    for (const [itemId, names] of Object.entries(pickupVisuals)) {
      const objects = names.flatMap((name) => matched.get(name) ?? []);
      if (objects.length === 0) continue;
      this.assetPickupVisuals.set(itemId, objects);
      this.placeAssetPickupVisuals(itemId, objects);
      this.prepareAssetPickupVisuals(itemId, objects);
      this.setProceduralPickupMarkerVisible(itemId, false);
      this.setAssetPickupVisualVisible(itemId, !this.hasInventoryItem(itemId));
    }

    for (const [sceneId, names] of Object.entries(storyVisuals)) {
      const objects = names.flatMap((name) => matched.get(name) ?? []);
      if (objects.length === 0) continue;
      this.assetStoryVisuals.set(sceneId, objects);
    }

    for (const phaseVisual of phaseVisuals) {
      const objects = phaseVisual.names.flatMap((name) => matched.get(name) ?? []);
      if (objects.length === 0) continue;
      this.assetPhaseVisuals.push({ objects, activeSceneIds: phaseVisual.activeSceneIds });
    }
    this.createTargetGlowLights();
    this.bindLibraryFallReveal(handle);
    this.storyPhaseDirty = true;
    this.syncStoryPhase();
  }

  private applyAssetPickupSpots(handle: InteriorAssetHandle): void {
    const pickupSpots = handle.meta?.pickupSpots ?? {};
    for (const [itemId, spots] of Object.entries(pickupSpots)) {
      const pickup = this.room.pickups.find((p) => p.itemId === itemId);
      if (!pickup || spots.length === 0) continue;
      const clearSpots = spots.filter((spot) => !this.collides(spot.x, spot.z));
      const choices = clearSpots.length > 0 ? clearSpots : spots;
      const spot = choices[Math.floor(Math.random() * choices.length)];
      pickup.position.set(spot.x, pickup.position.y, spot.z);
      pickup.glow.position.set(spot.x, pickup.glow.position.y, spot.z);
      if (spot.radius) pickup.radius = spot.radius;
    }
  }

  private placeAssetPickupVisuals(itemId: string, objects: THREE.Object3D[]): void {
    const pickup = this.room.pickups.find((p) => p.itemId === itemId);
    if (!pickup || objects.length === 0) return;

    const box = new THREE.Box3();
    for (const obj of objects) box.expandByObject(obj);
    if (box.isEmpty()) return;

    const center = new THREE.Vector3();
    box.getCenter(center);
    const delta = new THREE.Vector3(pickup.position.x - center.x, 0, pickup.position.z - center.z);
    for (const obj of objects) {
      obj.position.add(delta);
      obj.updateMatrixWorld(true);
    }
  }

  private clearAssetFlickerLights(): void {
    for (const entry of this.assetFlickerLights) {
      this.scene.remove(entry.light);
    }
    this.assetFlickerLights.length = 0;
  }

  private createAssetFlickerLights(handle: InteriorAssetHandle): void {
    for (const def of handle.meta?.flickerLights ?? []) {
      if (!def.followPickupId && (typeof def.x !== "number" || typeof def.z !== "number")) continue;
      const light = new THREE.PointLight(def.color ?? 0xff2a21, 0, def.distance ?? 4, 2.1);
      light.name = def.name ?? "asset_red_flicker_light";
      light.position.set(def.x ?? 0, def.y, def.z ?? 0);
      this.scene.add(light);
      this.assetFlickerLights.push({
        light,
        baseIntensity: def.intensity ?? 1.4,
        speed: def.speed ?? 3.4,
        phase: def.phase ?? Math.random() * Math.PI * 2,
        y: def.y,
        followPickupId: def.followPickupId,
        followPickup: def.followPickupId ? this.pickupsByItemId.get(def.followPickupId) : undefined,
      });
    }
  }

  private setProceduralPickupMarkerVisible(itemId: string, visible: boolean): void {
    for (const pickup of this.room.pickups) {
      if (pickup.itemId !== itemId) continue;
      pickup.glow.traverse((child) => {
        if (child !== pickup.glow) child.visible = visible;
      });
    }
  }

  private setProceduralStoryTriggerMarkersVisible(visible: boolean): void {
    for (const trigger of this.room.storyTriggers) {
      trigger.glow.traverse((child) => {
        if (child !== trigger.glow) child.visible = visible;
      });
    }
  }

  private prepareAssetPickupVisuals(itemId: string, objects: THREE.Object3D[]): void {
    const meshes = new Set<THREE.Mesh>();
    for (const object of objects) {
      object.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) meshes.add(mesh);
      });
    }

    const isPaperClue = itemId === "receipt" || itemId === "talisman";
    const emissiveIntensity = isPaperClue ? 1.22 : 0.18;
    for (const mesh of meshes) {
      const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const materials = source.map((material) => {
        const clone = material.clone() as THREE.MeshStandardMaterial;
        if (clone.emissive) {
          clone.emissive.setHex(itemId === "talisman" ? 0xd32218 : 0xc71b1d);
          clone.emissiveIntensity = Math.max(clone.emissiveIntensity ?? 0, emissiveIntensity);
        }
        // Both clue assets are very thin paper meshes. Some source faces have
        // downward normals, so front-face culling made them vanish from the
        // player's standing viewpoint even though their GLB nodes were loaded.
        if (isPaperClue) clone.side = THREE.DoubleSide;
        clone.needsUpdate = true;
        return clone;
      });
      mesh.material = Array.isArray(mesh.material) ? materials : materials[0];
    }
  }

  private applyAssetStorySpots(handle: InteriorAssetHandle): void {
    const spots = handle.meta?.storySpots ?? {};
    for (const trigger of this.room.storyTriggers) {
      const spot = spots[trigger.sceneId];
      if (!spot) continue;
      trigger.position.set(spot.x, spot.y, spot.z);
      trigger.glow.position.set(spot.x, spot.y, spot.z);
      if (spot.radius) trigger.radius = spot.radius;
    }

    for (const [sceneId, candidates] of Object.entries(handle.meta?.storySpotCandidates ?? {})) {
      const trigger = this.storyTriggersBySceneId.get(sceneId);
      if (!trigger || candidates.length === 0) continue;
      const candidate = candidates[Math.floor(Math.random() * candidates.length)];
      trigger.position.set(candidate.x, candidate.y, candidate.z);
      trigger.glow.position.set(candidate.x, candidate.y, candidate.z);
      if (candidate.radius) trigger.radius = candidate.radius;
    }
  }

  private createTargetGlowLights(): void {
    for (const light of this.targetGlowLights.values()) this.scene.remove(light);
    this.targetGlowLights.clear();

    const add = (key: string, position: THREE.Vector3, intensity = 4.2, distance = 4.6): void => {
      const light = new THREE.PointLight(0xc70b18, 0, distance, 1.8);
      light.name = `scene01_target_${key.replace(":", "_")}`;
      light.position.set(position.x, Math.max(0.72, position.y + 0.42), position.z);
      light.userData.baseIntensity = intensity;
      this.scene.add(light);
      this.targetGlowLights.set(key, light);
    };

    for (const pickup of this.room.pickups) {
      if (pickup.itemId === "flashlight" || pickup.itemId === "receipt" || pickup.itemId === "talisman") {
        add(
          `pickup:${pickup.itemId}`,
          pickup.position,
          pickup.itemId === "flashlight" ? 5.6 : 5.1,
          pickup.itemId === "flashlight" ? 5.2 : 4.7,
        );
      }
    }
    for (const trigger of this.room.storyTriggers) {
      if (trigger.sceneId === "library_intro" || trigger.sceneId === "library_shelf") {
        add(`story:${trigger.sceneId}`, trigger.position, trigger.sceneId === "library_shelf" ? 5.2 : 4.6, 4.8);
      }
    }
  }

  private updateTargetGlowLights(t: number): void {
    const sceneId = this.storySceneId;
    for (const [key, light] of this.targetGlowLights) {
      let active = false;
      if (key.startsWith("pickup:")) {
        const itemId = key.slice("pickup:".length);
        const pickup = this.pickupsByItemId.get(itemId);
        active = !!pickup && !pickup.taken && pickup.glow.visible && !this.hasInventoryItem(itemId);
      } else {
        const targetSceneId = key.slice("story:".length);
        const trigger = this.storyTriggersBySceneId.get(targetSceneId);
        active = sceneId === targetSceneId && !!trigger && !trigger.triggered && trigger.glow.visible;
      }
      light.visible = active;
      light.intensity = active
        ? light.userData.baseIntensity * (0.82 + 0.18 * Math.sin(t * 3.7 + light.position.z * 0.2))
        : 0;
    }
  }

  private bindLibraryFallReveal(handle: InteriorAssetHandle): void {
    const reveal = handle.meta?.fallReveal;
    if (!reveal || this.roomKind !== "library") return;
    this.fallenLinwei = handle.root.getObjectByName(reveal.fallenName)
      ?? handle.root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(reveal.fallenName));
    if (this.fallenLinwei) {
      this.fallenLinwei.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh || !mesh.material) return;
        const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const cloned = source.map((material) => material.clone());
        mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
      });
      this.setFallenLinweiAppearance(this.fallRevealed);
    }
    const revealTarget = new THREE.Vector3(reveal.body.x, reveal.body.y, reveal.body.z);
    if (this.fallenLinwei) {
      const box = new THREE.Box3().setFromObject(this.fallenLinwei);
      if (!box.isEmpty()) box.getCenter(revealTarget);
    }

    // Bind the actual authored streetlamp. Its saved metadata is only a
    // fallback; the live mesh bounds keep the crimson cone attached if the
    // underlying model is re-exported with a changed pivot.
    const authoredStreetlamp = handle.root.getObjectByName(reveal.streetlampName)
      ?? handle.root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(reveal.streetlampName));
    const lampPosition = new THREE.Vector3(reveal.lamp.x, reveal.lamp.y, reveal.lamp.z);
    if (authoredStreetlamp) {
      const lampBox = new THREE.Box3().setFromObject(authoredStreetlamp);
      if (!lampBox.isEmpty()) {
        const lampCenter = lampBox.getCenter(new THREE.Vector3());
        lampPosition.set(lampCenter.x, lampBox.max.y - 0.72, lampCenter.z);
      }
    }

    // The existing streetlamp mesh remains visible but unlit. This spotlight
    // switches on at impact and throws a narrow crimson cone onto Lin Wei.
    this.fallSpotlightTarget = new THREE.Object3D();
    this.fallSpotlightTarget.position.copy(revealTarget);
    this.scene.add(this.fallSpotlightTarget);
    this.fallSpotlight = new THREE.SpotLight(0xff101d, this.fallRevealed ? 120 : 0, 21, 0.31, 0.36, 1.38);
    this.fallSpotlight.name = "library_fall_crimson_spotlight";
    this.fallSpotlight.position.copy(lampPosition);
    this.fallSpotlight.target = this.fallSpotlightTarget;
    if (!this.isMobile) {
      this.fallSpotlight.castShadow = true;
      this.fallSpotlight.shadow.mapSize.set(1024, 1024);
    }
    this.scene.add(this.fallSpotlight);

    // A tight crimson bounce at ground level keeps the prone mesh readable;
    // visually it belongs to the streetlamp pool and has no visible fixture.
    this.fallBodyFill = new THREE.PointLight(0xb90716, this.fallRevealed ? 4.2 : 0, 5.5, 1.9);
    this.fallBodyFill.name = "library_fall_body_bounce";
    this.fallBodyFill.position.set(revealTarget.x, revealTarget.y + 0.9, revealTarget.z);
    this.scene.add(this.fallBodyFill);
  }

  private revealLibraryFall(): void {
    if (this.fallRevealed) return;
    this.fallRevealed = true;
    this.hasLeftShelfAfterFall = true;
    this.setFallenLinweiAppearance(true);
    this.outsideRedLight.intensity = 1.35;
    // Keep navigational storm light alive; the spotlight supplies the crimson
    // focus without switching the handheld beam or the courtyard off.
    this.outsideWhiteLight.intensity = 5.2;
    if (this.fallSpotlight) this.fallSpotlight.intensity = 120;
    if (this.fallBodyFill) this.fallBodyFill.intensity = 4.2;
    const reveal = this.assetHandle?.meta?.fallReveal;
    if (reveal) {
      // The root pivot sits near one limb in the authored GLB. Aim at the
      // visible mesh bounds so the whole prone figure, not the empty pivot, is
      // centred when the story glass clears.
      const target = new THREE.Vector3(reveal.body.x, reveal.body.y, reveal.body.z);
      if (this.fallenLinwei) {
        const box = new THREE.Box3().setFromObject(this.fallenLinwei);
        if (!box.isEmpty()) box.getCenter(target);
      }
      // The trigger fires before the player reaches the body. During the
      // full-screen impact frame, advance to a clear courtyard vantage on the
      // same approach line so the partition cannot occlude the final reveal.
      const approach = new THREE.Vector3(
        this.camera.position.x - target.x,
        0,
        this.camera.position.z - target.z,
      );
      if (approach.lengthSq() > 0.001) {
        approach.normalize().multiplyScalar(3.8);
        const desired = new THREE.Vector3(target.x + approach.x, this.camera.position.y, target.z + approach.z);
        const safe = this.findNearestAssetClearPoint(desired);
        this.camera.position.set(
          safe.x,
          this.room.floorHeightAt(safe.x, safe.z) + this.crouchState.eyeHeight,
          safe.z,
        );
      }
      const dx = target.x - this.camera.position.x;
      const dz = target.z - this.camera.position.z;
      const horizontalDistance = Math.max(0.1, Math.hypot(dx, dz));
      const pitch = Math.atan2(target.y - this.camera.position.y, horizontalDistance);
      this.cameraController.setLook(Math.atan2(-dx, -dz), pitch);
      // `lookAt` is the final visual authority for this one-shot cinematic;
      // it avoids Euler-order drift between yaw and a steep downward pitch.
      this.camera.lookAt(target);
    }
  }

  private setFallenLinweiAppearance(revealed: boolean): void {
    if (!this.fallenLinwei) return;
    this.fallenLinwei.visible = revealed;
    if (!revealed) return;
    this.fallenLinwei.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        const lit = material as THREE.MeshStandardMaterial;
        if (!lit.emissive) continue;
        lit.emissive.setHex(0x5c0209);
        lit.emissiveIntensity = Math.max(lit.emissiveIntensity ?? 0, 1.65);
        lit.needsUpdate = true;
      }
    });
  }

  private addAssetCeilingLights(handle: InteriorAssetHandle): void {
    handle.root.updateMatrixWorld(true);
    handle.root.traverse((object) => {
      if (!/^legacy_crimson_fluorescent_\d+_tube$/.test(object.name)) return;
      const mesh = object as THREE.Mesh;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        const standard = material as THREE.MeshStandardMaterial;
        if (standard.emissive) {
          standard.emissive.setHex(0xb20d18);
          standard.emissiveIntensity = Math.max(standard.emissiveIntensity ?? 0, 4.2);
        }
      }
      const light = new THREE.PointLight(0xa70d18, 4.9, 9.2, 1.65);
      light.name = `${object.name}_light`;
      light.position.copy(object.getWorldPosition(new THREE.Vector3()));
      light.position.y -= 0.12;
      this.scene.add(light);
      this.assetCeilingLights.push(light);
    });
  }

  private clearAssetCeilingLights(): void {
    for (const light of this.assetCeilingLights) this.scene.remove(light);
    this.assetCeilingLights.length = 0;
  }

  private setProceduralPickupGuideLightsVisible(visible: boolean): void {
    for (const pickup of this.room.pickups) {
      pickup.glow.traverse((child) => {
        if ((child as THREE.Light).isLight) child.visible = visible;
      });
    }
  }

  private setAssetPickupVisualVisible(itemId: string, visible: boolean): void {
    const objects = this.assetPickupVisuals.get(itemId);
    if (!objects) return;
    for (const obj of objects) obj.visible = visible;
  }

  private syncAssetPhaseVisuals(sceneId?: string): void {
    for (const phaseVisual of this.assetPhaseVisuals) {
      const visible = sceneId ? phaseVisual.activeSceneIds.includes(sceneId) : phaseVisual.activeSceneIds.length === 0;
      for (const obj of phaseVisual.objects) obj.visible = visible;
    }
  }

  private setProceduralRoomVisualsVisible(visible: boolean): void {
    const preserved = new Set<THREE.Object3D>();
    const preserveTree = (obj?: THREE.Object3D | null): void => {
      if (!obj) return;
      obj.traverse((child) => preserved.add(child));
    };

    for (const pickup of this.room.pickups) preserveTree(pickup.glow);
    for (const trigger of this.room.storyTriggers) preserveTree(trigger.glow);
    for (const door of this.room.doors) preserveTree(door.group);
    // Small structural fallbacks intentionally survive real-asset loading.
    // They cover authored openings that are absent from an imported GLB.
    this.room.root.traverse((obj) => {
      if (obj.userData.keepWithAsset) preserveTree(obj);
    });
    // A real GLB may provide named phase visuals (for example the library's
    // iron gate).  Keeping the procedural equivalent visible at the same
    // coordinates produces z-fighting / interpenetration.  The procedural
    // object remains in the collision and trigger model, but its rendering is
    // only retained when no real phase visual was matched.
    if (this.assetPhaseVisuals.length === 0) {
      for (const phaseObject of this.room.phaseObjects) preserveTree(phaseObject.object);
    }
    for (const npcGroup of this.room.npcGroups) preserveTree(npcGroup);

    this.room.root.traverse((obj) => {
      if (obj === this.room.root || preserved.has(obj)) return;
      obj.visible = visible;
    });
  }

  private collides(x: number, z: number): boolean {
    if (this.perfEnabled) this.perfCollisionCalls++;
    for (const c of this.colliders) {
      if (!this.isColliderActive(c)) continue;
      if (
        x > c.minX - this.playerRadius &&
        x < c.maxX + this.playerRadius &&
        z > c.minZ - this.playerRadius &&
        z < c.maxZ + this.playerRadius
      ) {
        return true;
      }
    }
    return false;
  }

  private clampToBounds(value: number, min: number, max: number): number {
    return THREE.MathUtils.clamp(value, min + this.playerRadius, max - this.playerRadius);
  }

  private findClearSpawn(spawn: THREE.Vector3): THREE.Vector3 {
    return this.findNearestClearPoint(spawn) ?? spawn;
  }

  private findNearestAssetClearPoint(origin: THREE.Vector3): THREE.Vector3 {
    const baseX = this.clampToBounds(origin.x, this.bounds.minX, this.bounds.maxX);
    const baseZ = this.clampToBounds(origin.z, this.bounds.minZ, this.bounds.maxZ);
    if (!this.collides(baseX, baseZ)) return new THREE.Vector3(baseX, origin.y, baseZ);

    for (let radius = 0.4; radius <= 8; radius += 0.35) {
      const steps = Math.max(16, Math.ceil(radius * 12));
      for (let step = 0; step < steps; step++) {
        const angle = (Math.PI * 2 * step) / steps;
        const x = this.clampToBounds(origin.x + Math.cos(angle) * radius, this.bounds.minX, this.bounds.maxX);
        const z = this.clampToBounds(origin.z + Math.sin(angle) * radius, this.bounds.minZ, this.bounds.maxZ);
        if (!this.collides(x, z)) return new THREE.Vector3(x, origin.y, z);
      }
    }
    return new THREE.Vector3(baseX, origin.y, baseZ);
  }

  private findNearestClearPoint(origin: THREE.Vector3): THREE.Vector3 | null {
    const candidates: THREE.Vector3[] = [origin.clone()];
    const sortedNodes = [...this.room.guideNodes].sort(
      (a, b) => Math.hypot(origin.x - a.x, origin.z - a.z) - Math.hypot(origin.x - b.x, origin.z - b.z),
    );
    for (const node of sortedNodes) candidates.push(new THREE.Vector3(node.x, origin.y, node.z));

    for (const radius of [0.45, 0.75, 1.05, 1.4, 1.8, 2.3]) {
      for (let i = 0; i < 16; i++) {
        const a = (Math.PI * 2 * i) / 16;
        candidates.push(new THREE.Vector3(origin.x + Math.cos(a) * radius, origin.y, origin.z + Math.sin(a) * radius));
      }
    }

    for (const candidate of candidates) {
      const x = this.clampToBounds(candidate.x, this.bounds.minX, this.bounds.maxX);
      const z = this.clampToBounds(candidate.z, this.bounds.minZ, this.bounds.maxZ);
      if (!this.collides(x, z)) return new THREE.Vector3(x, origin.y, z);
    }
    return null;
  }

  private resolvePenetration(): void {
    const pos = this.camera.position;
    for (let pass = 0; pass < 8; pass++) {
      if (this.perfEnabled) this.perfPenetrationScans++;
      let moved = false;
      for (const collider of this.colliders) {
        if (!this.isColliderActive(collider)) continue;
        const push = this.getPenetrationPush(pos.x, pos.z, collider);
        if (!push) continue;
        pos.x = this.clampToBounds(pos.x + push.x, this.bounds.minX, this.bounds.maxX);
        pos.z = this.clampToBounds(pos.z + push.z, this.bounds.minZ, this.bounds.maxZ);
        moved = true;
      }
      if (!moved) return;
    }

    if (this.collides(pos.x, pos.z)) {
      const safe = this.findNearestClearPoint(pos);
      if (safe) pos.set(safe.x, pos.y, safe.z);
    }
  }

  private getPenetrationPush(x: number, z: number, collider: AABB): { x: number; z: number } | null {
    const minX = collider.minX - this.playerRadius;
    const maxX = collider.maxX + this.playerRadius;
    const minZ = collider.minZ - this.playerRadius;
    const maxZ = collider.maxZ + this.playerRadius;
    if (x <= minX || x >= maxX || z <= minZ || z >= maxZ) return null;

    const left = x - minX;
    const right = maxX - x;
    const top = z - minZ;
    const bottom = maxZ - z;
    const min = Math.min(left, right, top, bottom);
    const nudge = min + 0.015;

    if (min === left) return { x: -nudge, z: 0 };
    if (min === right) return { x: nudge, z: 0 };
    if (min === top) return { x: 0, z: -nudge };
    return { x: 0, z: nudge };
  }

  private hasInventoryItem(itemId: string): boolean {
    return this.inventoryItems.has(itemId);
  }

  private clampStamina(value: number): number {
    return Math.max(0, Math.min(100, value));
  }

  /**
   * Snapshot shared story inputs once per frame. React/Zustand replace the
   * inventory array when it changes, so rebuilding the Set is an event-time
   * cost rather than repeated linear scans throughout the frame.
   */
  private refreshSharedState(): void {
    const sceneId = this.getStorySceneId?.();
    const inventory = this.getInventory?.() ?? EMPTY_INVENTORY;
    if (sceneId !== this.storySceneId) {
      this.storySceneId = sceneId;
      this.storyPhaseDirty = true;
    }
    if (inventory !== this.inventorySnapshot || inventory.length !== this.inventoryItems.size) {
      this.inventorySnapshot = inventory;
      this.inventoryItems.clear();
      for (const itemId of inventory) this.inventoryItems.add(itemId);
      this.storyPhaseDirty = true;
    }
  }

  /** Accept genuine story-system stamina changes without resetting local float progress. */
  private syncExternalStamina(): void {
    if (!this.getStamina) return;
    const externalStamina = Math.round(this.clampStamina(this.getStamina()));
    if (externalStamina === this.persistedStamina) return;
    this.persistedStamina = externalStamina;
    this.runtimeStamina = externalStamina;
    this.staminaStoreSyncElapsed = 0;
  }

  /** Persist changed integer UI state at no more than 10 Hz. */
  private syncStaminaToStore(): void {
    if (!this.setStamina || this.staminaStoreSyncElapsed < STAMINA_STORE_SYNC_INTERVAL) return;
    const nextStamina = Math.round(this.runtimeStamina);
    if (nextStamina === this.persistedStamina) return;
    this.persistedStamina = nextStamina;
    this.staminaStoreSyncElapsed = 0;
    if (this.perfEnabled) this.perfStaminaWrites++;
    this.setStamina(nextStamina);
  }

  private syncLightingState(dt: number, t: number): void {
    const hasFlashlight = this.hasInventoryItem("flashlight");
    const libraryProfile = this.roomKind === "library";
    const previewingUnmappedAsset = Boolean(this.assetHandle && !this.assetHandle.meta);
    const targetAmbient = previewingUnmappedAsset
      ? 0.32
      : hasFlashlight ? (libraryProfile ? 0.34 : 0.85) : libraryProfile ? 0.18 : 0.22;
    const targetFill = previewingUnmappedAsset
      ? 0.18
      : hasFlashlight ? (libraryProfile ? 0.22 : 0.55) : libraryProfile ? 0.11 : 0.14;
    const targetNear = previewingUnmappedAsset
      ? 0.25
      : hasFlashlight ? (libraryProfile ? 0.18 : 0.85) : libraryProfile ? 0.24 : 0.24;
    const k = Math.min(1, dt * 6);

    this.ambientLight.intensity = THREE.MathUtils.lerp(this.ambientLight.intensity, targetAmbient, k);
    this.fillLight.intensity = THREE.MathUtils.lerp(this.fillLight.intensity, targetFill, k);
    this.nearFillLight.intensity = THREE.MathUtils.lerp(this.nearFillLight.intensity, targetNear, k);

    if (hasFlashlight || previewingUnmappedAsset) {
      this.flashlightSys.update(dt, t);
      if (previewingUnmappedAsset) this.flashlight.intensity *= 8;
      if (this.fallRevealed) {
        // Outside, retain a readable beam while letting the red streetlamp own
        // the body reveal. Back in the shelf room it returns to full strength.
        this.flashlight.intensity *= this.isInLibraryExterior() ? 0.82 : 1.18;
      }
    } else {
      this.flashlight.intensity = 0;
    }

    this.updateBloodLight(t);
    this.updateAssetFlickerLights(t);
    this.updateTargetGlowLights(t);
    this.updateLibraryStorm(t);
    this.updateLibraryCeilingLights(t);
  }

  private isInLibraryExterior(): boolean {
    return this.roomKind === "library" && this.camera.position.x > 2.35 && this.camera.position.z > 13.5;
  }

  private updateLibraryStorm(t: number): void {
    if (this.roomKind !== "library") return;
    const sceneId = this.storySceneId;
    const storyAllowsStorm = sceneId === "library_fall" || sceneId === "dorm_baiqiu";
    const exterior = storyAllowsStorm && this.isInLibraryExterior();

    if (exterior !== this.libraryStormActive) {
      this.libraryStormActive = exterior;
      if (exterior) {
        startLibraryStorm();
        this.nextLightningAt = t + 5.5 + Math.random() * 4.5;
      } else {
        stopLibraryStorm();
        this.nextLightningAt = Number.POSITIVE_INFINITY;
        this.lightningFlashUntil = 0;
      }
    }

    if (exterior && t >= this.nextLightningAt) {
      this.lightningFlashUntil = t + 0.19;
      this.nextLightningAt = t + 17 + Math.random() * 14;
      window.dispatchEvent(new CustomEvent("zju-horror-library-lightning", { detail: { active: true } }));
      playLibraryThunder(0.2 + Math.random() * 0.28);
    }

    const lightning = exterior && t < this.lightningFlashUntil;
    const whiteTarget = exterior ? (lightning ? 16 : 5.2) : 2.8;
    const ceilingTarget = exterior ? (lightning ? 11 : 2.7) : 0;
    this.outsideWhiteLight.intensity = THREE.MathUtils.lerp(this.outsideWhiteLight.intensity, whiteTarget, 0.18);
    this.outsideCeilingLight.intensity = THREE.MathUtils.lerp(this.outsideCeilingLight.intensity, ceilingTarget, 0.2);
  }

  private updateLibraryCeilingLights(t: number): void {
    if (this.roomKind !== "library") return;
    if (this.fallRevealed && this.camera.position.z > 32) this.hasLeftShelfAfterFall = true;
    if (this.hasLeftShelfAfterFall && this.camera.position.z < 29.5) this.libraryReturnFlicker = true;

    for (let index = 0; index < this.assetCeilingLights.length; index++) {
      const light = this.assetCeilingLights[index];
      if (!this.libraryReturnFlicker) {
        light.intensity = 4.75 + Math.sin(t * 1.7 + index * 0.83) * 0.22;
        continue;
      }
      const harsh = Math.sin(t * (13.5 + (index % 4) * 2.1) + index * 1.91);
      const dropout = harsh > 0.58 || Math.sin(t * 3.3 + index * 2.7) > 0.86;
      light.intensity = dropout ? 0.16 : 4.9 + Math.max(0, harsh) * 1.7;
    }
  }

  private scheduleBloodFlash(t: number): void {
    this.nextBloodFlashAt = t + 5 + Math.random() * 3;
  }

  private updateBloodLight(t: number): void {
    if (!this.bloodLightEnabled) {
      this.bloodLight.intensity = 0;
      return;
    }

    if (t >= this.nextBloodFlashAt) {
      this.bloodFlashUntil = t + 0.22 + Math.random() * 0.12;
      this.scheduleBloodFlash(this.bloodFlashUntil);
    }

    if (t < this.bloodFlashUntil) {
      const phase = (this.bloodFlashUntil - t) / 0.34;
      const pulse = 0.7 + 0.3 * Math.sin(t * 58);
      this.bloodLight.intensity = this.bloodLightMaxIntensity * Math.max(0.35, phase) * pulse;
    } else {
      const ember = 0.08 + 0.035 * Math.sin(t * 2.7);
      this.bloodLight.intensity = this.bloodLightMaxIntensity * ember;
    }
  }

  private updateAssetFlickerLights(t: number): void {
    for (const entry of this.assetFlickerLights) {
      if (entry.followPickupId) {
        const pickup = entry.followPickup;
        const visible = !!pickup && !pickup.taken && pickup.glow.visible && !this.hasInventoryItem(entry.followPickupId);
        entry.light.visible = visible;
        if (!visible || !pickup) {
          entry.light.intensity = 0;
          continue;
        }
        entry.light.position.set(pickup.position.x, entry.y, pickup.position.z);
      }

      const shimmer =
        0.48 +
        0.34 * Math.sin(t * entry.speed + entry.phase) +
        0.18 * Math.sin(t * entry.speed * 2.73 + entry.phase * 1.7);
      entry.light.intensity = entry.baseIntensity * THREE.MathUtils.clamp(shimmer, 0.12, 1.0);
    }
  }

  private toggleColliderDebug(): void {
    if (this.debugColliders) {
      this.scene.remove(this.debugColliders);
      this.debugColliders.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose?.();
      });
      this.debugColliders = undefined;
      return;
    }

    const group = new THREE.Group();
    group.name = "debug-colliders";
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff4d6d,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });
    for (const c of this.colliders) {
      const w = c.maxX - c.minX;
      const d = c.maxZ - c.minZ;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), mat.clone());
      mesh.position.set((c.minX + c.maxX) / 2, 0.04, (c.minZ + c.maxZ) / 2);
      group.add(mesh);
    }
    const boundsMat = new THREE.MeshBasicMaterial({ color: 0x79d7ff, wireframe: true, transparent: true, opacity: 0.5 });
    const boundsMesh = new THREE.Mesh(
      new THREE.BoxGeometry(this.bounds.maxX - this.bounds.minX, 0.12, this.bounds.maxZ - this.bounds.minZ),
      boundsMat,
    );
    boundsMesh.position.set((this.bounds.minX + this.bounds.maxX) / 2, 0.07, (this.bounds.minZ + this.bounds.maxZ) / 2);
    group.add(boundsMesh);
    this.debugColliders = group;
    this.scene.add(group);
  }

  private update(dt: number): void {
    const ctx = this.moveCtx;
    this.syncExternalStamina();
    this.staminaStoreSyncElapsed = Math.min(
      STAMINA_STORE_SYNC_INTERVAL,
      this.staminaStoreSyncElapsed + dt,
    );

    // 1. Feed the latest input snapshot into the context.
    const snap = this.inputManager.pollInput();
    if (this.runtimeStamina <= 0) snap.sprintHeld = false;
    ctx.input = snap;
    if (snap.moveX === 0 && snap.moveZ === 0) {
      // Horror exploration needs deterministic stops, not FPS-style inertia:
      // once W/A/S/D or the virtual stick is released, horizontal motion ends
      // on this frame instead of coasting through the room.
      ctx.velocity.x = 0;
      ctx.velocity.y = 0;
    }

    // 2. Update ground state.
    ctx.wasOnGround = ctx.isOnGround;
    const floorY = ctx.floorHeightAt(this.camera.position.x, this.camera.position.z);
    const eyeH = this.crouchState.eyeHeight;
    ctx.isOnGround = this.camera.position.y <= floorY + eyeH + 0.05 && ctx.velocityY <= 0;

    // If grounded and velocityY is negligible, snap to floor.
    if (ctx.isOnGround) {
      ctx.velocityY = 0;
      this.camera.position.y = floorY + eyeH;
    }

    // 3. Tick timers.
    if (ctx.jumpBufferTimer > 0 && ctx.isOnGround) {
      // Buffer expires if we're already on ground too long — but we let
      // states consume it. Just count it down.
    }

    // 4. Run the state machine — states modify ctx.velocity / ctx.velocityY.
    this.stateMachine.update(dt, ctx);

    // 4b. Stamina management: sprinting costs stamina; walking/idle regains.
    const currentStamina = this.runtimeStamina;
    if (this.stateMachine.currentName === "run" && currentStamina > 0) {
      // Sprinting burns ~12 stamina per second → ~8 s full sprint.
      this.runtimeStamina = Math.max(0, currentStamina - 12 * dt);
      // Prevent sprinting when exhausted.
      if (this.runtimeStamina <= 0) ctx.input.sprintHeld = false;
    } else if (this.stateMachine.currentName === "walk" || this.stateMachine.currentName === "idle") {
      // Walking / idle recovers ~6 stamina per second.
      this.runtimeStamina = Math.min(100, currentStamina + 6 * dt);
    }
    this.syncStaminaToStore();

    // 4c. Low-stamina visibility effects: thicken fog, desaturate scene.
    const lowStamina = currentStamina <= 25;
    if (lowStamina !== this.lowStaminaWarning) {
      this.lowStaminaWarning = lowStamina;
      if (lowStamina) {
        (this.scene.fog as any).density = 0.06;
        this.scene.background = new THREE.Color(0x040608);
      } else {
        (this.scene.fog as any).density = undefined;
        this.scene.background = new THREE.Color(0x080b12);
      }
    }

    const hasHorizontalMotion = ctx.velocity.x !== 0 || ctx.velocity.y !== 0;
    if (!this.staticColliderSet || hasHorizontalMotion) this.resolvePenetration();

    // 5. Resolve horizontal collision (per-axis wall sliding), preserved from the old code.
    if (hasHorizontalMotion) {
      const pos = this.camera.position;
      const dx = ctx.velocity.x * dt;
      const dz = ctx.velocity.y * dt;
      let nx = this.clampToBounds(pos.x + dx, this.bounds.minX, this.bounds.maxX);
      if (this.collides(nx, pos.z)) {
        nx = pos.x;
        ctx.velocity.x = 0;
      }
      let nz = this.clampToBounds(pos.z + dz, this.bounds.minZ, this.bounds.maxZ);
      if (this.collides(nx, nz)) {
        nz = pos.z;
        ctx.velocity.y = 0;
      }
      pos.x = nx;
      pos.z = nz;
    }

    if (!this.staticColliderSet || hasHorizontalMotion) this.resolvePenetration();

    // 6. Resolve vertical movement (gravity + floor snap).
    if (!ctx.isOnGround) {
      const posY = this.camera.position.y + ctx.velocityY * dt;
      const floorAtNewPos = ctx.floorHeightAt(this.camera.position.x, this.camera.position.z);
      const eyeH = this.crouchState.eyeHeight;
      if (posY <= floorAtNewPos + eyeH && ctx.velocityY <= 0) {
        // Landed this frame.
        this.camera.position.y = floorAtNewPos + eyeH;
        ctx.velocityY = 0;
      } else {
        this.camera.position.y = posY;
      }
    }

    // 7. Camera post-update (FOV, head bob, sync yaw).
    this.cameraController.update(dt, ctx, this.stateMachine.currentName);

    // 7b. Story-state machine: only the current narrative phase is interactive.
    this.syncStoryPhase();

    // 8. Collect pickups (automatic proximity or E within the wider manual range).
    this.collectPickups();
    // 9. Check story triggers with the same shared interaction rule.
    this.collectStoryTriggers();
    // 10. Door interaction (E key).
    this.handleDoorInteraction();
    // 10. Update guide line to active trigger.
    this.updateGuideLine();
  }

  /**
   * Shared interaction rule for current and future pickups/story points.
   * The stored radius remains the authored baseline; each interaction type
   * supplies its automatic scale, while an E press is accepted within 125%.
   */
  private isInteractionInRange(distanceSquared: number, baseRadius: number, automaticScale: number): boolean {
    const scale = this.ePressed ? MANUAL_INTERACTION_RADIUS_SCALE : automaticScale;
    const effectiveRadius = baseRadius * scale;
    return distanceSquared <= effectiveRadius * effectiveRadius;
  }

  /** Collect a glowing item by proximity, or by pressing E in the wider manual range. */
  private collectPickups(): void {
    const p = this.camera.position;
    for (const item of this.room.pickups) {
      if (item.taken || !item.glow.visible) continue;
      const dx = p.x - item.position.x;
      const dz = p.z - item.position.z;
      if (this.isInteractionInRange(dx * dx + dz * dz, item.radius, PICKUP_AUTO_RADIUS_SCALE)) {
        item.taken = true;
        item.glow.visible = false;
        this.setAssetPickupVisualVisible(item.itemId, false);
        // Do not let the same E press interact with a nearby door as well.
        this.ePressed = false;
        this.onPickup?.(item.itemId, item.name);
        break;
      }
    }
  }

  /** Fire a story/exit trigger by proximity, or by pressing E in the wider manual range. */
  private collectStoryTriggers(): void {
    const p = this.camera.position;
    const triggers = this.room.storyTriggers;
    for (let i = 0; i < triggers.length; i++) {
      const trigger = triggers[i];
      if (trigger.triggered || !trigger.glow.visible) continue;
      const fallReveal = trigger.sceneId === "library_fall" ? this.assetHandle?.meta?.fallReveal : undefined;
      if (fallReveal?.approachMinX !== undefined && p.x < fallReveal.approachMinX) continue;
      const targetX = fallReveal?.body.x ?? trigger.position.x;
      const targetZ = fallReveal?.body.z ?? trigger.position.z;
      const activationRadius = fallReveal?.triggerDistance ?? trigger.radius;
      const dx = p.x - targetX;
      const dz = p.z - targetZ;
      if (this.isInteractionInRange(dx * dx + dz * dz, activationRadius, STORY_AUTO_RADIUS_SCALE)) {
        trigger.triggered = true;
        trigger.glow.visible = false;
        // A successful story interaction owns this key press; doors must not also receive it.
        this.ePressed = false;
        if (trigger.sceneId === "library_fall") this.revealLibraryFall();
        if (trigger.action === "exit") {
          this.onExitTrigger?.();
        } else {
          this.onStoryTrigger?.(trigger.sceneId);
        }
        break; // only one trigger per frame
      }
    }
  }

  /** Create a dashed red guide line on the floor. */
  private createGuideLine(): void {
    const mat = new THREE.LineDashedMaterial({
      color: 0xff2020,
      dashSize: 0.8,
      gapSize: 0.4,
      linewidth: 1,
      depthTest: false,
    });
    const geo = new THREE.BufferGeometry();
    const arr = new Float32Array(GUIDE_MAX_POINTS * 3);
    geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    geo.setDrawRange(0, 0);
    this.guideLine = new THREE.Line(geo, mat);
    this.guideLine.visible = false;
    this.scene.add(this.guideLine);
  }

  /** Point the dashed line from camera to the first non-triggered story trigger. */
  private updateGuideLine(): void {
    if (!this.guideLine) return;
    if (this.suppressLegacyGuidance) {
      this.guideLine.visible = false;
      return;
    }
    const active = this.room.storyTriggers.find((t) => !t.triggered && t.glow.visible);
    if (!active) {
      this.guideLine.visible = false;
      return;
    }
    const points = this.findGuideRoute(this.camera.position, active.position);
    const count = Math.min(points.length, GUIDE_MAX_POINTS);
    const pos = this.guideLine.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < count; i++) {
      const p = points[i];
      pos.setXYZ(i, p.x, this.room.floorHeightAt(p.x, p.z) + 0.08, p.z);
    }
    this.guideLine.geometry.setDrawRange(0, count);
    pos.needsUpdate = true;
    this.guideLine.computeLineDistances();
    this.guideLine.visible = count >= 2;
  }

  private syncStoryPhase(): void {
    if (!this.storyPhaseDirty) return;
    this.storyPhaseDirty = false;
    const sceneId = this.storySceneId;

    for (const trigger of this.room.storyTriggers) {
      const isActive = !trigger.triggered && this.isTriggerAvailable(trigger, sceneId);
      trigger.glow.visible = isActive;
    }

    for (const item of this.room.pickups) {
      const isActive = !item.taken && !this.hasInventoryItem(item.itemId) && this.isPickupAvailable(item, sceneId);
      item.glow.visible = isActive;
      this.setAssetPickupVisualVisible(item.itemId, isActive);
    }

    for (const phaseObject of this.room.phaseObjects) {
      phaseObject.object.visible = this.assetPhaseVisuals.length === 0 && this.isPhaseObjectAvailable(phaseObject, sceneId);
    }
    this.syncAssetPhaseVisuals(sceneId);

    // ── NPC 显现由 storyEngine 统一管理 ──
    const npcRevealIds = getInteriorNpcRevealSceneIds(this.roomKind);
    const shouldShowNpc = this.roomKind !== "library" && !!sceneId && npcRevealIds.includes(sceneId as any);
    for (const npcGroup of this.room.npcGroups) {
      npcGroup.visible = shouldShowNpc;
    }
  }

  private isTriggerAvailable(trigger: { activeSceneIds: string[] }, sceneId?: string): boolean {
    if (!sceneId) return trigger.activeSceneIds.length === 0;
    return trigger.activeSceneIds.includes(sceneId);
  }

  private isPickupAvailable(item: { activeSceneIds?: string[] }, sceneId?: string): boolean {
    if (!item.activeSceneIds?.length) return true;
    if (!sceneId) return false;
    return item.activeSceneIds.includes(sceneId);
  }

  private isPhaseObjectAvailable(item: { activeSceneIds: string[] }, sceneId?: string): boolean {
    if (!sceneId) return item.activeSceneIds.length === 0;
    return item.activeSceneIds.includes(sceneId);
  }

  private findGuideRoute(start: THREE.Vector3, end: THREE.Vector3): THREE.Vector3[] {
    const nodes = this.room.guideNodes;
    const startPoint = new THREE.Vector3(start.x, 0, start.z);
    const endPoint = new THREE.Vector3(end.x, 0, end.z);
    if (!nodes.length) return [startPoint, endPoint];

    const startNode = this.findNearestVisibleGuideNode(startPoint);
    const endNode = this.findNearestVisibleGuideNode(endPoint);
    if (!startNode || !endNode) return [startPoint, endPoint];

    const nodeIds = this.findGuideNodePath(startNode.id, endNode.id);
    const route = [startPoint];
    for (const id of nodeIds) {
      const node = nodes.find((n) => n.id === id);
      if (node) route.push(new THREE.Vector3(node.x, 0, node.z));
    }
    route.push(endPoint);
    return this.removeDuplicateGuidePoints(route);
  }

  private findNearestVisibleGuideNode(point: THREE.Vector3): InteriorGuideNode | null {
    let nearest: InteriorGuideNode | null = null;
    let nearestDist = Number.POSITIVE_INFINITY;
    let nearestVisible: InteriorGuideNode | null = null;
    let nearestVisibleDist = Number.POSITIVE_INFINITY;

    for (const node of this.room.guideNodes) {
      const dist = Math.hypot(point.x - node.x, point.z - node.z);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = node;
      }
      const nodePoint = new THREE.Vector3(node.x, 0, node.z);
      if (dist < nearestVisibleDist && this.isSegmentClear(point, nodePoint)) {
        nearestVisibleDist = dist;
        nearestVisible = node;
      }
    }

    return nearestVisible ?? nearest;
  }

  private findGuideNodePath(startId: string, endId: string): string[] {
    if (startId === endId) return [startId];

    const byId = new Map(this.room.guideNodes.map((node) => [node.id, node]));
    const open = new Set(byId.keys());
    const dist = new Map<string, number>();
    const prev = new Map<string, string>();
    for (const id of open) dist.set(id, Number.POSITIVE_INFINITY);
    dist.set(startId, 0);

    while (open.size > 0) {
      let current: string | null = null;
      let currentDist = Number.POSITIVE_INFINITY;
      for (const id of open) {
        const d = dist.get(id) ?? Number.POSITIVE_INFINITY;
        if (d < currentDist) {
          current = id;
          currentDist = d;
        }
      }
      if (!current || currentDist === Number.POSITIVE_INFINITY) break;
      open.delete(current);
      if (current === endId) break;

      const node = byId.get(current);
      if (!node) continue;
      for (const link of node.links) {
        const next = byId.get(link);
        if (!next || !open.has(link)) continue;
        const step = Math.hypot(node.x - next.x, node.z - next.z);
        const alt = currentDist + step;
        if (alt < (dist.get(link) ?? Number.POSITIVE_INFINITY)) {
          dist.set(link, alt);
          prev.set(link, current);
        }
      }
    }

    const path: string[] = [];
    let cursor: string | undefined = endId;
    while (cursor) {
      path.unshift(cursor);
      if (cursor === startId) break;
      cursor = prev.get(cursor);
    }
    return path[0] === startId ? path : [startId, endId];
  }

  private removeDuplicateGuidePoints(points: THREE.Vector3[]): THREE.Vector3[] {
    const result: THREE.Vector3[] = [];
    for (const point of points) {
      const previous = result[result.length - 1];
      if (!previous || Math.hypot(previous.x - point.x, previous.z - point.z) > 0.08) {
        result.push(point);
      }
    }
    return result;
  }

  private isSegmentClear(a: THREE.Vector3, b: THREE.Vector3): boolean {
    for (const collider of this.colliders) {
      if (!this.isColliderActive(collider)) continue;
      if (this.segmentHitsCollider(a, b, collider, this.playerRadius * 0.65)) return false;
    }
    return true;
  }

  private segmentHitsCollider(a: THREE.Vector3, b: THREE.Vector3, collider: AABB, pad: number): boolean {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    const steps = Math.max(2, Math.ceil(length / 0.18));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = a.x + dx * t;
      const z = a.z + dz * t;
      if (
        x > collider.minX - pad &&
        x < collider.maxX + pad &&
        z > collider.minZ - pad &&
        z < collider.maxZ + pad
      ) {
        return true;
      }
    }
    return false;
  }

  private isColliderActive(collider: AABB): boolean {
    if (collider.isActive && !collider.isActive()) return false;
    if (!collider.activeSceneIds?.length) return true;
    const sceneId = this.storySceneId;
    return Boolean(sceneId && collider.activeSceneIds.includes(sceneId));
  }

  private reportPerformance(frameStartedAt: number): void {
    if (this.perfWindowStartedAt === 0) this.perfWindowStartedAt = frameStartedAt;
    if (this.perfLastFrameAt > 0) this.perfFrameTimes.push(frameStartedAt - this.perfLastFrameAt);
    this.perfLastFrameAt = frameStartedAt;

    const elapsed = frameStartedAt - this.perfWindowStartedAt;
    if (elapsed < 1000 || this.perfFrameTimes.length === 0) return;

    let frameTimeTotal = 0;
    for (const frameTime of this.perfFrameTimes) frameTimeTotal += frameTime;
    const sortedFrameTimes = [...this.perfFrameTimes].sort((a, b) => a - b);
    const p95Index = Math.min(sortedFrameTimes.length - 1, Math.ceil(sortedFrameTimes.length * 0.95) - 1);
    const seconds = elapsed / 1000;
    const renderInfo = this.renderer.info;
    console.info([
      "[InteriorPerf]",
      `FPS: ${(this.perfFrameTimes.length / seconds).toFixed(1)}`,
      `Frame: ${(frameTimeTotal / this.perfFrameTimes.length).toFixed(2)} ms avg / ${sortedFrameTimes[p95Index].toFixed(2)} ms p95`,
      `Draw calls: ${renderInfo.render.calls}`,
      `Triangles: ${renderInfo.render.triangles}`,
      `Memory: ${renderInfo.memory.geometries} geometries / ${renderInfo.memory.textures} textures`,
      `Colliders: ${this.colliders.length}`,
      `Collision calls/s: ${(this.perfCollisionCalls / seconds).toFixed(1)}`,
      `Penetration scans/s: ${(this.perfPenetrationScans / seconds).toFixed(1)}`,
      `Stamina writes/s: ${(this.perfStaminaWrites / seconds).toFixed(1)}`,
    ].join("\n"));

    this.perfWindowStartedAt = frameStartedAt;
    this.perfFrameTimes.length = 0;
    this.perfCollisionCalls = 0;
    this.perfPenetrationScans = 0;
    this.perfStaminaWrites = 0;
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);
    const frameStartedAt = this.perfEnabled ? performance.now() : 0;
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.clock.elapsedTime;

    this.refreshSharedState();
    this.update(dt);
    this.room.update(t, this.camera.position);
    // Update door rotation animations.
    for (const door of this.room.doors) door.update(dt);

    this.syncLightingState(dt, t);

    this.renderer.render(this.scene, this.camera);
    if (this.perfEnabled) this.reportPerformance(frameStartedAt);
  };
}
