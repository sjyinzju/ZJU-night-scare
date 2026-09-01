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
import {
  getMedicalInteriorSegment,
  getInteriorAssetObject,
  loadInteriorAsset,
  preloadNextMedicalInteriorSegment,
  type InteriorAssetHandle,
  type InteriorAssetMeta,
  type MedicalInteriorSegment,
} from "./InteriorAssetLoader";
import type { InteriorCollisionMap, InteriorMapObstacle } from "./InteriorCollisionMap";
import { playBaishaThunder, playLibraryThunder, startLibraryStorm, stopLibraryStorm } from "../audio/proceduralAudio";
import { JumpscarePipeline } from "../JumpscarePipeline";
import { pickSeeded } from "./seededRandom";

export type InteriorAssetState = "loading" | "ready" | "failed";
export type BaishaGameplayPhase = "photo" | "balcony" | "computer" | "paused" | "complete";
export type BaishaGameplayTrigger = "photo" | "balcony" | "computer";
export type BaishaGhostState = "dormant" | "chase";
type BaishaChaseBranch = "shortcut" | "pursuit";

type NavigationClearZone = NonNullable<InteriorAssetMeta["navigationClearZones"]>[number];

/** Remove only the authored clear rectangle, preserving the surrounding wall/furniture collision. */
function cutObstacleByClearZone(obstacle: InteriorMapObstacle, zone: NavigationClearZone): InteriorMapObstacle[] {
  if (zone.kind && zone.kind !== obstacle.kind) return [obstacle];
  const cutMinX = Math.max(obstacle.minX, zone.minX);
  const cutMaxX = Math.min(obstacle.maxX, zone.maxX);
  const cutMinZ = Math.max(obstacle.minZ, zone.minZ);
  const cutMaxZ = Math.min(obstacle.maxZ, zone.maxZ);
  if (cutMinX >= cutMaxX || cutMinZ >= cutMaxZ) return [obstacle];

  const pieces: InteriorMapObstacle[] = [];
  const add = (minX: number, maxX: number, minZ: number, maxZ: number): void => {
    if (maxX - minX > 0.001 && maxZ - minZ > 0.001) {
      pieces.push({ minX, maxX, minZ, maxZ, kind: obstacle.kind });
    }
  };
  add(obstacle.minX, cutMinX, obstacle.minZ, obstacle.maxZ);
  add(cutMaxX, obstacle.maxX, obstacle.minZ, obstacle.maxZ);
  add(cutMinX, cutMaxX, obstacle.minZ, cutMinZ);
  add(cutMinX, cutMaxX, cutMaxZ, obstacle.maxZ);
  return pieces;
}

export interface InteriorMapSnapshot {
  bounds: InteriorCollisionMap["bounds"];
  obstacles: InteriorMapObstacle[];
  player: { x: number; z: number };
  objective?: { x: number; z: number };
  ghost?: { x: number; z: number; state: BaishaGhostState };
  fallenPerson?: { x: number; z: number };
  exitSegment?: { minX: number; maxX: number; z: number; color?: "red" | "green" };
  layoutPaths?: Array<Array<{ x: number; z: number }>>;
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
  /** Stable per-playthrough seed for scene-one random placements. */
  getSessionSeed?: () => number;
  /** Current player inventory for door key checks. */
  getDoorInventory?: () => string[];
  /** Reports when authored static visuals are safe to reveal. */
  onAssetStateChange?: (state: InteriorAssetState) => void;
  /** Reports one-shot proximity beats in the authored Baisha dorm sequence. */
  onBaishaTrigger?: (trigger: BaishaGameplayTrigger) => void;
  /** Reports the authored chase hand-off and its opening jumpscare. */
  onBaishaChaseStart?: () => void;
  /** Reports that the corridor ghost caught the player. */
  onBaishaCapture?: () => void;
  /** Reports that the player crossed the two-door true exit. */
  onBaishaExit?: () => void;
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
/** Baisha remains escapable without the drink, but the chase is deliberately tighter. */
const BAISHA_CHASE_SPRINT_MULTIPLIER = 0.9;
/** The drink restores the authored dorm sprint speed for the rest of this chase. */
const BAISHA_ENERGY_SPRINT_MULTIPLIER = 1;
/** Prevent run/walk/FOV oscillation when exhausted stamina recovers by fractions. */
const BAISHA_AUTOSPRINT_RECOVERY_STAMINA = 24;

type BaishaTubeRuntime = {
  group: THREE.Group;
  material: THREE.MeshStandardMaterial;
  position: THREE.Vector3;
  zone: "room" | "balcony" | "corridor";
  corridorIndex: number;
  active: boolean;
  intensity: number;
};

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
  private readonly buildingId: string;

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
  private readonly libraryPursuitLight: THREE.PointLight;

  private room: RoomBuildResult;
  private readonly roomKind: RoomKind;
  private colliders: AABB[];
  private staticColliderSet = false;
  private bounds: AABB;
  private playerRadius = DEFAULT_PLAYER_RADIUS;
  private readonly blueprint: InteriorBlueprint;
  private assetHandle?: InteriorAssetHandle;
  private medicalSegment?: MedicalInteriorSegment;
  private readonly medicalPreloadsStarted = new Set<MedicalInteriorSegment>();
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
  private readonly assetCeilingFixtures: THREE.Vector3[] = [];
  private nextAssetCeilingPoolUpdateAt = Number.NEGATIVE_INFINITY;
  private readonly onPickup?: (itemId: string, name: string) => void;
  private readonly onStoryTrigger?: (sceneId: string) => void;
  private readonly onExitTrigger?: () => void;
  private readonly getStorySceneId?: () => string;
  private readonly getInventory?: () => string[];
  private readonly getStamina?: () => number;
  private readonly setStamina?: (value: number) => void;
  private readonly getSessionSeed?: () => number;
  private readonly onAssetStateChange?: (state: InteriorAssetState) => void;
  private readonly onBaishaTrigger?: (trigger: BaishaGameplayTrigger) => void;
  private readonly onBaishaChaseStart?: () => void;
  private readonly onBaishaCapture?: () => void;
  private readonly onBaishaExit?: () => void;
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
  private lastPursuitZ = 0;
  private pursuitDistance = 7.2;
  private nextPursuitWhisperAt = 0;
  private pursuitHitCooldownUntil = 0;
  private readonly baishaTubes: BaishaTubeRuntime[] = [];
  private readonly baishaLightPool: THREE.PointLight[] = [];
  private baishaTubeGeometry?: THREE.BoxGeometry;
  private baishaHousingGeometry?: THREE.BoxGeometry;
  private baishaHousingMaterial?: THREE.MeshStandardMaterial;
  private baishaCorridorProgress = -1;
  private baishaRevealAhead = 3;
  private nextBaishaLightingUpdateAt = 0;
  private baishaLightning?: THREE.SpotLight;
  private baishaLightningTarget?: THREE.Object3D;
  private baishaCorridorWindow?: THREE.Group;
  private baishaCorridorWindowGlass?: THREE.MeshStandardMaterial;
  private baishaCorridorWindowFlash?: THREE.PointLight;
  private baishaBoundaryWalls?: THREE.Group;
  private baishaRaisedCeiling?: THREE.Group;
  private nextBaishaLightningAt = Number.POSITIVE_INFINITY;
  private baishaLightningUntil = 0;
  private baishaGameplayPhase: BaishaGameplayPhase = "photo";
  private baishaTriggeredPhase?: BaishaGameplayTrigger;
  private baishaGhostState: BaishaGhostState = "dormant";
  private baishaChaseArmed = false;
  private baishaDebugEnergyChecked = false;
  private baishaDebugDoorChecked = false;
  private baishaDebugExitChecked = false;
  private readonly baishaChaseExitOrigin = new THREE.Vector2();
  private readonly baishaChaseViewPoint = new THREE.Vector3();
  private baishaDoorCollider?: AABB;
  private baishaGhostVisual?: THREE.Object3D;
  private readonly baishaGhostPosition = new THREE.Vector2();
  private baishaChaseBranch: BaishaChaseBranch = "shortcut";
  private baishaChasePathIndex = 1;
  private baishaShortcutPath: Array<{ x: number; z: number }> = [];
  private baishaPursuitPath: Array<{ x: number; z: number }> = [];
  private baishaPursuitPathIndex = 1;
  private baishaNextRepathAt = Number.NEGATIVE_INFINITY;
  private readonly baishaLastPursuitTarget = new THREE.Vector2(Number.NaN, Number.NaN);
  private baishaChaseTriggeredAt = Number.POSITIVE_INFINITY;
  private baishaCaptureDisabledUntil = Number.POSITIVE_INFINITY;
  private baishaHalfSpeedUntil = Number.NEGATIVE_INFINITY;
  private baishaTrueExitOpen = false;
  private baishaPlayerReachedTriangle = false;
  private baishaCaptureReported = false;
  private baishaExitReported = false;
  private baishaEnergyActive = false;
  private baishaAutoSprintRecovering = false;
  private baishaPreExitColliders?: AABB[];
  private baishaPreExitMapObstacles?: InteriorMapObstacle[];
  private baishaComputerLight?: THREE.PointLight;
  private readonly baishaComputerMaterials: Array<{
    material: THREE.MeshStandardMaterial;
    emissive: THREE.Color;
    emissiveIntensity: number;
    color: THREE.Color;
  }> = [];
  private baishaShadowCacheEnabled = false;
  private readonly baishaShadowCameraPosition = new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN);
  private readonly baishaShadowCameraQuaternion = new THREE.Quaternion(Number.NaN, Number.NaN, Number.NaN, Number.NaN);
  private gameplayPaused = false;

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
  private readonly visualReviewMode: boolean;
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
    if (this.gameplayPaused) return;
    if (!this.isMobile && !this.pointerLocked) this.requestPointerLock();
  };

  constructor(options: Interior3DOptions) {
    this.container = options.container;
    this.isMobile = options.isMobile ?? false;
    this.buildingId = options.buildingId;
    this.onPickup = options.onPickup;
    this.onStoryTrigger = options.onStoryTrigger;
    this.onExitTrigger = options.onExitTrigger;
    this.getStorySceneId = options.getStorySceneId;
    this.getInventory = options.getInventory;
    this.getStamina = options.getStamina;
    this.setStamina = options.setStamina;
    this.getSessionSeed = options.getSessionSeed;
    this.getDoorInventory = options.getDoorInventory;
    this.onAssetStateChange = options.onAssetStateChange;
    this.onBaishaTrigger = options.onBaishaTrigger;
    this.onBaishaChaseStart = options.onBaishaChaseStart;
    this.onBaishaCapture = options.onBaishaCapture;
    this.onBaishaExit = options.onBaishaExit;
    // Review-only noclip remains available for inspecting the Baisha asset.
    // The medical school used to need it because the teaching floor plate sat
    // inside the collision slice; the loader now shifts the asset down 0.5 m
    // so the top floor collides correctly and review mode is no longer needed.
    this.visualReviewMode = options.buildingId === "dorm-baisha"
      && new URLSearchParams(window.location.search).get("baishaReview") === "1";
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
    this.bloodLight.visible = false;
    this.bloodLight.position.set(-1.25, 3.05, -4.75);
    this.scene.add(this.bloodLight);
    this.scheduleBloodFlash(0);
    this.outsideRedLight = new THREE.PointLight(0x71030a, 0, 20, 1.55);
    this.outsideRedLight.visible = false;
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
    this.outsideCeilingLight.visible = false;
    this.outsideCeilingLight.position.set(4.3, 8.2, 36.5);
    this.outsideCeilingLight.lookAt(4.3, 0, 36.5);
    this.scene.add(this.outsideCeilingLight);

    this.libraryPursuitLight = new THREE.PointLight(0xff1025, 0, 7.5, 1.85);
    this.libraryPursuitLight.name = "library_return_pursuit_light";
    this.libraryPursuitLight.visible = false;
    this.scene.add(this.libraryPursuitLight);

    // Flashlight follows the camera.
    this.flashlight = new THREE.SpotLight(0xfff2d0, 8.6, 23, Math.PI / 5.6, 0.42, 1.35);
    this.flashlight.visible = false;
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
    this.outsideWhiteLight.visible = this.outsideWhiteLight.intensity > 0;
    if (this.roomKind === "dorm" && options.buildingId === "dorm-baisha") {
      this.scene.background = new THREE.Color(0x0b0103);
      this.scene.fog = new THREE.Fog(0x110104, 4, 30);
      this.ambientLight.color.setHex(0x3a1116);
      this.fillLight.color.setHex(0x481019);
      this.fillLight.groundColor.setHex(0x080103);
      this.nearFillLight.color.setHex(0xb67579);
      this.outsideRedLight.position.set(29.2, 1.7, 1.2);
      this.outsideRedLight.distance = 15;
      this.outsideRedLight.intensity = 2.1;
      this.outsideRedLight.visible = true;
    }
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

  setGameplayPaused(paused: boolean): void {
    this.gameplayPaused = paused;
    if (!paused) {
      this.inputManager.reset();
      return;
    }
    this.exitPointerLock();
    this.inputManager.reset();
    this.moveCtx.velocity.x = 0;
    this.moveCtx.velocity.y = 0;
    this.ePressed = false;
  }

  setBaishaGameplayPhase(phase: BaishaGameplayPhase): void {
    if (this.baishaGameplayPhase === phase) return;
    this.baishaGameplayPhase = phase;
    this.baishaTriggeredPhase = undefined;
    this.setBaishaComputerGlow(phase === "computer");
  }

  completeBaishaDorm(): void {
    const gameplay = this.assetHandle?.meta?.baishaGameplay;
    if (!gameplay || this.baishaGameplayPhase === "complete") return;
    this.baishaGameplayPhase = "complete";
    this.baishaTriggeredPhase = undefined;
    this.setBaishaComputerGlow(false);
    for (const name of gameplay.door.visualNames) {
      const door = this.assetHandle ? getInteriorAssetObject(this.assetHandle.root, name) : undefined;
      if (door) door.visible = false;
    }
    if (this.baishaShadowCacheEnabled) this.renderer.shadowMap.needsUpdate = true;
    if (this.baishaDoorCollider) {
      const collider = this.baishaDoorCollider;
      this.colliders = this.colliders.filter((candidate) => candidate !== collider);
      this.baishaDoorCollider = undefined;
    }
    this.gameplayPaused = false;
    this.inputManager.reset();
  }

  /** Restore the authored checkpoint immediately after the dorm forum. */
  resetBaishaChaseCheckpoint(): void {
    const gameplay = this.assetHandle?.meta?.baishaGameplay;
    const chase = gameplay?.chase;
    if (this.roomKind !== "dorm" || !gameplay || !chase) return;

    this.restoreBaishaTrueExit();
    this.baishaGameplayPhase = "complete";
    this.baishaTriggeredPhase = undefined;
    this.baishaGhostState = "dormant";
    this.baishaChaseArmed = false;
    this.baishaChaseBranch = "shortcut";
    this.baishaChasePathIndex = 1;
    this.baishaShortcutPath = this.getBaishaShortcutPath();
    this.baishaPursuitPath = [];
    this.baishaPursuitPathIndex = 1;
    this.baishaNextRepathAt = Number.NEGATIVE_INFINITY;
    this.baishaLastPursuitTarget.set(Number.NaN, Number.NaN);
    this.baishaChaseTriggeredAt = Number.POSITIVE_INFINITY;
    this.baishaCaptureDisabledUntil = Number.POSITIVE_INFINITY;
    this.baishaHalfSpeedUntil = Number.NEGATIVE_INFINITY;
    this.baishaPlayerReachedTriangle = false;
    this.baishaCaptureReported = false;
    this.baishaExitReported = false;
    this.baishaEnergyActive = false;
    this.baishaAutoSprintRecovering = false;
    this.baishaDebugEnergyChecked = false;
    this.baishaDebugDoorChecked = false;
    this.baishaDebugExitChecked = false;
    this.moveCtx.sprintSpeed = this.blueprint.movement.sprintSpeed;

    const start = this.baishaShortcutPath[0] ?? gameplay.chasePrep?.ghost;
    if (start) this.setBaishaGhostPosition(start.x, start.z);
    if (this.baishaGhostVisual) this.baishaGhostVisual.visible = true;

    const energy = this.pickupsByItemId.get("energy");
    if (energy) {
      energy.taken = false;
      energy.glow.visible = true;
      this.setAssetPickupVisualVisible("energy", true);
    }

    for (const name of gameplay.door.visualNames) {
      const door = this.assetHandle ? getInteriorAssetObject(this.assetHandle.root, name) : undefined;
      if (door) door.visible = false;
    }
    if (this.baishaDoorCollider) {
      this.colliders = this.colliders.filter((candidate) => candidate !== this.baishaDoorCollider);
      this.baishaDoorCollider = undefined;
    }

    const checkpoint = chase.checkpoint;
    this.camera.position.set(
      checkpoint.x,
      this.room.floorHeightAt(checkpoint.x, checkpoint.z) + this.crouchState.eyeHeight,
      checkpoint.z,
    );
    this.cameraController.setLook(checkpoint.yaw, -0.04);
    this.gameplayPaused = false;
    this.inputManager.reset();
    this.moveCtx.velocity.x = 0;
    this.moveCtx.velocity.y = 0;
    this.ePressed = false;
    if (this.baishaShadowCacheEnabled) this.renderer.shadowMap.needsUpdate = true;
  }

  /** Live position plus the authored model's floor-plan obstacles. */
  getInteriorMapSnapshot(): InteriorMapSnapshot | null {
    const collisionMap = this.assetHandle?.collisionMap;
    if (!collisionMap || (this.roomKind !== "library" && this.roomKind !== "dorm")) return null;
    const sceneId = this.getStorySceneId?.();
    let objective: InteriorMapSnapshot["objective"];
    if (this.roomKind === "library" && sceneId === "library_intro") {
      if (!this.hasInventoryItem("flashlight")) {
        const flashlight = this.pickupsByItemId.get("flashlight");
        if (flashlight && !flashlight.taken) objective = { x: flashlight.position.x, z: flashlight.position.z };
      } else {
        const trigger = this.storyTriggersBySceneId.get(sceneId);
        if (trigger && !trigger.triggered) objective = { x: trigger.position.x, z: trigger.position.z };
      }
    } else if (this.roomKind === "library" && (sceneId === "library_receipt" || sceneId === "library_talisman")) {
      const itemId = sceneId === "library_receipt" ? "receipt" : "talisman";
      const pickup = this.pickupsByItemId.get(itemId);
      if (pickup && !pickup.taken) objective = { x: pickup.position.x, z: pickup.position.z };
    } else if (this.roomKind === "library" && sceneId === "library_shelf") {
      const trigger = this.storyTriggersBySceneId.get(sceneId);
      if (trigger && !trigger.triggered) objective = { x: trigger.position.x, z: trigger.position.z };
    } else if (this.roomKind === "dorm") {
      const gameplay = this.assetHandle?.meta?.baishaGameplay;
      const target = this.baishaGameplayPhase === "photo"
        ? gameplay?.photo
        : this.baishaGameplayPhase === "balcony"
          ? gameplay?.balcony
          : this.baishaGameplayPhase === "computer"
            ? gameplay?.computer
            : undefined;
      if (target) objective = { x: target.x, z: target.z };
    }
    const fallReveal = this.assetHandle?.meta?.fallReveal;
    const baishaMinimap = this.roomKind === "dorm"
      ? this.assetHandle?.meta?.baishaGameplay?.minimap
      : undefined;
    const baishaExitSegment = baishaMinimap && this.baishaGameplayPhase === "complete"
      ? this.baishaPlayerReachedTriangle || this.baishaTrueExitOpen
        ? { ...baishaMinimap.trueExitSegment, color: "red" as const }
        : { ...baishaMinimap.falseExitSegment, color: "green" as const }
      : undefined;
    return {
      bounds: collisionMap.bounds,
      obstacles: this.interiorMapObstacles ?? collisionMap.obstacles,
      player: { x: this.camera.position.x, z: this.camera.position.z },
      objective,
      ghost: this.baishaGhostState === "chase"
        ? {
            x: this.baishaGhostPosition.x,
            z: this.baishaGhostPosition.y,
            state: this.baishaGhostState,
          }
        : undefined,
      fallenPerson: this.fallRevealed && fallReveal
        ? { x: fallReveal.body.x, z: fallReveal.body.z }
        : undefined,
      exitSegment: baishaExitSegment
        ?? (sceneId === "dorm_baiqiu" ? this.assetHandle?.meta?.exitSegment : undefined),
      layoutPaths: baishaMinimap?.paths,
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

  debugTeleportToBaishaTarget(): string {
    if (this.roomKind !== "dorm") return "当前场景不是白沙宿舍";
    const gameplay = this.assetHandle?.meta?.baishaGameplay;
    const phase = this.baishaGameplayPhase;
    if (!gameplay || phase === "paused") return "当前没有可前往的白沙目标";
    if (phase === "complete") {
      const door = gameplay.door.collisionBounds;
      const centerX = (door.minX + door.maxX) * 0.5;
      const chase = gameplay.chasePrep;
      if (this.baishaGhostState === "chase") {
        if (this.baishaTrueExitOpen && !this.baishaDebugExitChecked) {
          const exit = gameplay.chase?.trueExit;
          if (!exit) return "真出口元数据未加载";
          const centerX = (exit.clearZones[0].minX + exit.clearZones[0].maxX) * 0.5;
          const startZ = Math.min(...exit.clearZones.map((zone) => zone.minZ)) - 0.45;
          const endZ = Math.max(...exit.clearZones.map((zone) => zone.maxZ)) + 0.45;
          const sampleCount = 25;
          let blockedSamples = 0;
          for (let index = 0; index < sampleCount; index++) {
            const z = THREE.MathUtils.lerp(startZ, endZ, index / (sampleCount - 1));
            if (this.collides(centerX, z)) blockedSamples++;
          }
          const doorParts = exit.visualNames.map((name) => (
            this.assetHandle ? getInteriorAssetObject(this.assetHandle.root, name) : undefined
          ));
          const unresolvedDoorParts = doorParts.filter((object) => !object).length;
          const visibleDoorParts = doorParts.filter((object) => object?.visible).length;
          this.camera.position.set(
            centerX,
            this.room.floorHeightAt(centerX, startZ) + this.crouchState.eyeHeight,
            startZ,
          );
          this.cameraController.setLook(Math.PI, -0.04);
          this.baishaCaptureDisabledUntil = Math.max(this.baishaCaptureDisabledUntil, this.clock.elapsedTime + 60);
          this.baishaDebugExitChecked = true;
          return blockedSamples === 0 && visibleDoorParts === 0 && unresolvedDoorParts === 0
            ? "真出口检测：两扇门及碰撞均已移除"
            : `真出口检测：${visibleDoorParts} 个门组件仍可见，${unresolvedDoorParts} 个节点未解析，${blockedSamples}/${sampleCount} 个通道采样受阻`;
        }
        const turnSamples = [12.25, 12.55, 12.85];
        const blockedSamples = turnSamples.filter((x) => this.collides(x, -19.28)).length;
        const targetX = 12.55;
        const targetZ = -19.28;
        this.camera.position.set(
          targetX,
          this.room.floorHeightAt(targetX, targetZ) + this.crouchState.eyeHeight,
          targetZ,
        );
        this.cameraController.setLook(-Math.PI / 2, -0.04);
        // The debug teleport exists to inspect the late chase route. Keep its
        // artificial repositioning from immediately triggering capture while
        // QA observes the shortcut, turns, minimap marker, and ceiling.
        this.baishaCaptureDisabledUntil = Math.max(this.baishaCaptureDisabledUntil, this.clock.elapsedTime + 60);
        const ghostPosition = `${this.baishaGhostPosition.x.toFixed(2)}, ${this.baishaGhostPosition.y.toFixed(2)}`;
        const activePathIndex = this.baishaChaseBranch === "shortcut"
          ? this.baishaChasePathIndex
          : this.baishaPursuitPathIndex;
        return blockedSamples === 0
          ? `第三转角检测：可通行（${this.baishaChaseBranch}，鬼影 ${ghostPosition}，路径节点 ${activePathIndex}）`
          : `第三转角检测：仍有 ${blockedSamples}/${turnSamples.length} 个阻挡采样`;
      }
      if (!this.baishaDebugEnergyChecked && this.baishaGhostState === "dormant") {
        const energy = this.pickupsByItemId.get("energy");
        const visuals = this.assetPickupVisuals.get("energy") ?? [];
        if (!energy) return "能量饮料检测：拾取点未创建";
        const outsideStripBlocked = [3.65, 4.25, 4.85].every((x) => (
          Array.from({ length: 13 }, (_, index) => THREE.MathUtils.lerp(-9.45, -20.0, index / 12))
            .every((z) => this.collides(x, z))
        ));
        const safeExitVerticalClear = Array.from(
          { length: 25 },
          (_, index) => THREE.MathUtils.lerp(-8.55, -19.28, index / 24),
        ).every((z) => !this.collides(6.45, z));
        const safeExitBottomTurnClear = Array.from(
          { length: 9 },
          (_, index) => THREE.MathUtils.lerp(6.45, 9.4, index / 8),
        ).every((x) => !this.collides(x, -19.28));
        const safeExitCorridorClear = safeExitVerticalClear && safeExitBottomTurnClear;
        const energyInSafeExitCorridor = Math.abs(energy.position.x - 6.45) <= 0.05;
        const viewZ = energy.position.z + energy.radius + 0.2;
        this.camera.position.set(
          energy.position.x,
          this.room.floorHeightAt(energy.position.x, viewZ) + this.crouchState.eyeHeight,
          viewZ,
        );
        this.cameraController.setLook(0, -0.72);
        this.baishaDebugEnergyChecked = true;
        const visibleVisuals = visuals.filter((object) => object.visible).length;
        return visuals.length > 0
          && visibleVisuals === visuals.length
          && outsideStripBlocked
          && safeExitCorridorClear
          && energyInSafeExitCorridor
          ? `能量饮料检测：模型位于安全出口走廊，墙外条带已封闭（${energy.position.x.toFixed(2)}, ${energy.position.z.toFixed(2)}）`
          : `能量饮料检测：模型 ${visibleVisuals}/${visuals.length}，墙外条带 ${outsideStripBlocked ? "已封闭" : "仍可进入"}，安全出口走廊 ${safeExitCorridorClear ? "畅通" : "受阻"}，饮料 ${energyInSafeExitCorridor ? "位置正确" : `误置于 x=${energy.position.x.toFixed(2)}`}`;
      }
      if (this.baishaDebugDoorChecked && chase && this.baishaGhostState === "dormant") {
        const z = chase.exitThresholdZ - 0.45;
        this.camera.position.set(centerX, this.room.floorHeightAt(centerX, z) + this.crouchState.eyeHeight, z);
        const dx = chase.ghost.x - this.camera.position.x;
        const dz = chase.ghost.z - this.camera.position.z;
        this.cameraController.setLook(Math.atan2(-dx, -dz), -0.04);
        return "追逐准备：观察瘦长鬼影";
      }
      const sampleCount = 9;
      let blockedSamples = 0;
      for (let index = 0; index < sampleCount; index++) {
        const z = THREE.MathUtils.lerp(door.minZ, door.maxZ, index / (sampleCount - 1));
        if (this.collides(centerX, z)) blockedSamples++;
      }
      this.camera.position.set(centerX, this.room.floorHeightAt(centerX, door.maxZ + 0.55) + this.crouchState.eyeHeight, door.maxZ + 0.55);
      this.cameraController.setLook(0, -0.08);
      this.baishaDebugDoorChecked = true;
      return blockedSamples === 0
        ? "门洞检测：可通行"
        : `门洞检测：仍有 ${blockedSamples}/${sampleCount} 个阻挡采样`;
    }
    const target = gameplay[phase];
    const targetVector = new THREE.Vector3(target.x, EYE_HEIGHT, target.z);
    let safe: THREE.Vector3 | undefined;
    for (const radius of [0, target.radius * 0.35, target.radius * 0.62, target.radius * 0.84]) {
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
    safe ??= this.findNearestClearPoint(targetVector)
      ?? this.findNearestAssetClearPoint(targetVector)
      ?? targetVector;
    this.camera.position.set(safe.x, this.room.floorHeightAt(safe.x, safe.z) + this.crouchState.eyeHeight, safe.z);
    const dx = target.x - safe.x;
    const dz = target.z - safe.z;
    this.cameraController.setLook(Math.atan2(-dx, -dz), -0.08);
    this.resolvePenetration();
    return `已前往白沙目标：${phase}`;
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
    this.scene.remove(this.libraryPursuitLight);
    stopLibraryStorm();
    window.dispatchEvent(new CustomEvent("zju-horror-library-lightning", { detail: { active: false } }));
    this.clearAssetFlickerLights();
    this.clearAssetCeilingLights();
    this.clearBaishaLighting();
    this.clearBaishaGameplay();
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
    const requiresAuthoredAsset = buildingId === "medical-college";
    const medicalSegment = requiresAuthoredAsset
      ? getMedicalInteriorSegment(this.getStorySceneId?.())
      : undefined;
    this.medicalSegment = medicalSegment;
    if (requiresAuthoredAsset) {
      // The old procedural medical room must never flash through while the
      // full multi-storey GLB is loading, nor reappear after a failed request.
      this.room.root.visible = false;
    }
    this.onAssetStateChange?.("loading");
    try {
      const handle = await loadInteriorAsset({
        buildingId,
        roomKind: this.roomKind,
        isMobile: this.isMobile,
        medicalSegment,
      });
      if (!handle) {
        if (requiresAuthoredAsset) {
          throw new Error(`No authored interior asset is mapped for ${buildingId}:${this.roomKind}`);
        }
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
      this.addBaishaLighting(handle);
      this.setupBaishaGameplay(handle);
      this.suppressLegacyGuidance = this.roomKind === "library" || !handle.meta;
      if (this.suppressLegacyGuidance) {
        this.bloodLightEnabled = false;
        this.bloodLight.intensity = 0;
        this.setProceduralStoryTriggerMarkersVisible(false);
        this.setProceduralPickupGuideLightsVisible(false);
        if (this.guideLine) this.guideLine.visible = false;
      }
      this.setProceduralRoomVisualsVisible(false);
      // Warm shaders, textures and shadow programs while the Baisha entry veil
      // is still opaque. This preserves the exact render settings while
      // removing the first visible frame hitch after the choice closes.
      if (this.roomKind === "dorm" && handle.meta?.buildingId === "dorm-baisha") {
        try {
          await this.renderer.compileAsync(this.scene, this.camera);
        } catch (compileError) {
          console.warn("[Interior3D] Shader warm-up was unavailable; continuing with the loaded asset:", compileError);
        }
      }
      if (this.disposed) return;
      if (this.roomKind === "dorm" && handle.meta?.buildingId === "dorm-baisha" && !this.isMobile) {
        // The authored dorm and its shadow casters are static. Reuse the exact
        // 1024px flashlight shadow map while the camera is still, then refresh
        // it on every position/rotation change. Quality is unchanged; the
        // redundant shadow pass disappears during idle/story reading frames.
        this.baishaShadowCacheEnabled = true;
        this.renderer.shadowMap.autoUpdate = false;
        this.renderer.shadowMap.needsUpdate = true;
        this.baishaShadowCameraPosition.copy(this.camera.position);
        this.baishaShadowCameraQuaternion.copy(this.camera.quaternion);
      }
      this.onAssetStateChange?.("ready");
      if (medicalSegment) this.preloadMedicalSegmentAfter(medicalSegment);
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
      console.warn(
        requiresAuthoredAsset
          ? "[Interior3D] Failed to load required medical-school asset; keeping the authored-only curtain visible:"
          : "[Interior3D] Failed to load static interior asset, using procedural fallback:",
        err,
      );
      if (!requiresAuthoredAsset) this.setProceduralRoomVisualsVisible(true);
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
    if (this.roomKind === "medical") {
      // The medical-school GLB spans more than 100 m. The default 30 m indoor
      // fog made distant, fully loaded geometry converge to the black
      // background, which looked like half of the model had failed to load.
      const spanX = assetBounds.maxX - assetBounds.minX;
      const spanZ = assetBounds.maxZ - assetBounds.minZ;
      const horizontalDiagonal = Math.hypot(spanX, spanZ);
      if (this.scene.fog instanceof THREE.Fog) {
        this.scene.fog.near = 9;
        this.scene.fog.far = Math.max(90, horizontalDiagonal * 1.05);
      }
      this.camera.far = Math.max(this.camera.far, horizontalDiagonal * 1.25);
      this.camera.updateProjectionMatrix();
      this.renderer.toneMappingExposure = 0.85;
      this.ambientLight.color.setHex(0xaeb8c4);
      this.fillLight.color.setHex(0x91a6bf);
      this.fillLight.groundColor.setHex(0x46515e);
    }
    // The procedural room uses a different coordinate system. Once an
    // authored GLB is present, its projected meshes become collision truth.
    const clearZones = handle.meta?.navigationClearZones ?? [];
    this.colliders = handle.collisionMap.obstacles.flatMap((obstacle) => (
      clearZones.reduce<InteriorMapObstacle[]>(
        (pieces, zone) => pieces.flatMap((piece) => cutObstacleByClearZone(piece, zone)),
        [obstacle],
      )
    ));
    const boundaryWallObstacles: InteriorMapObstacle[] = (handle.meta?.baishaBoundaryWalls ?? []).map((wall) => ({
      minX: wall.minX,
      maxX: wall.maxX,
      minZ: wall.minZ,
      maxZ: wall.maxZ,
      kind: "wall",
    }));
    this.colliders.push(...boundaryWallObstacles);
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
    this.interiorMapObstacles = [...this.interiorMapObstacles, ...boundaryWallObstacles];
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

  private preloadMedicalSegmentAfter(current: MedicalInteriorSegment): void {
    if (this.medicalPreloadsStarted.has(current)) return;
    this.medicalPreloadsStarted.add(current);
    void preloadNextMedicalInteriorSegment({
      buildingId: this.buildingId,
      roomKind: this.roomKind,
      isMobile: this.isMobile,
    }, current).catch((error) => {
      this.medicalPreloadsStarted.delete(current);
      console.warn(`[Interior3D] Medical ${current} follow-up preload was unavailable; entry will retry.`, error);
    });
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
      const spot = pickSeeded(this.getSessionSeed?.() ?? 0, `pickup:${itemId}`, choices) ?? choices[0];
      pickup.position.set(spot.x, spot.y ?? pickup.position.y, spot.z);
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
      if (itemId === "energy") obj.scale.multiplyScalar(1.2);
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
    const emissiveIntensity = itemId === "energy" ? 1.55 : isPaperClue ? 1.22 : 0.18;
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
      const candidate = pickSeeded(this.getSessionSeed?.() ?? 0, `story:${sceneId}`, candidates) ?? candidates[0];
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
      light.visible = false;
      light.position.set(position.x, Math.max(0.72, position.y + 0.42), position.z);
      light.userData.baseIntensity = intensity;
      this.scene.add(light);
      this.targetGlowLights.set(key, light);
    };

    for (const pickup of this.room.pickups) {
      if (
        pickup.itemId === "flashlight"
        || pickup.itemId === "receipt"
        || pickup.itemId === "talisman"
        || pickup.itemId === "energy"
      ) {
        add(
          `pickup:${pickup.itemId}`,
          pickup.position,
          pickup.itemId === "flashlight" ? 5.6 : pickup.itemId === "energy" ? 5.2 : 5.1,
          pickup.itemId === "flashlight" ? 5.2 : pickup.itemId === "energy" ? 4.8 : 4.7,
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
    this.fallSpotlight.visible = this.fallRevealed;
    this.fallSpotlight.position.copy(lampPosition);
    this.fallSpotlight.target = this.fallSpotlightTarget;
    if (!this.isMobile) {
      this.fallSpotlight.castShadow = true;
      this.fallSpotlight.shadow.mapSize.set(1024, 1024);
      // The lamp, target, body and courtyard are all static. Render this exact
      // 1024px shadow once at reveal instead of resubmitting the full library
      // geometry to the shadow pass every frame while the player walks away.
      this.fallSpotlight.shadow.autoUpdate = false;
    }
    this.scene.add(this.fallSpotlight);

    // A tight crimson bounce at ground level keeps the prone mesh readable;
    // visually it belongs to the streetlamp pool and has no visible fixture.
    this.fallBodyFill = new THREE.PointLight(0xb90716, this.fallRevealed ? 4.2 : 0, 5.5, 1.9);
    this.fallBodyFill.name = "library_fall_body_bounce";
    this.fallBodyFill.visible = this.fallRevealed;
    this.fallBodyFill.position.set(revealTarget.x, revealTarget.y + 0.9, revealTarget.z);
    this.scene.add(this.fallBodyFill);
  }

  private revealLibraryFall(): void {
    if (this.fallRevealed) return;
    this.fallRevealed = true;
    this.hasLeftShelfAfterFall = true;
    this.setFallenLinweiAppearance(true);
    this.outsideRedLight.intensity = 1.35;
    this.outsideRedLight.visible = true;
    // Keep navigational storm light alive; the spotlight supplies the crimson
    // focus without switching the handheld beam or the courtyard off.
    this.outsideWhiteLight.intensity = 5.2;
    if (this.fallSpotlight) {
      this.fallSpotlight.visible = true;
      this.fallSpotlight.intensity = 120;
      this.fallSpotlight.shadow.needsUpdate = true;
    }
    if (this.fallBodyFill) {
      this.fallBodyFill.visible = true;
      this.fallBodyFill.intensity = 4.2;
    }
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
      this.assetCeilingFixtures.push(object.getWorldPosition(new THREE.Vector3()));
    });

    const poolSize = Math.min(6, this.assetCeilingFixtures.length);
    for (let index = 0; index < poolSize; index++) {
      const light = new THREE.PointLight(0xa70d18, 4.9, 9.2, 1.65);
      light.name = `library_ceiling_light_pool_${index}`;
      this.scene.add(light);
      this.assetCeilingLights.push(light);
    }
    this.nextAssetCeilingPoolUpdateAt = Number.NEGATIVE_INFINITY;
  }

  private clearAssetCeilingLights(): void {
    for (const light of this.assetCeilingLights) this.scene.remove(light);
    this.assetCeilingLights.length = 0;
    this.assetCeilingFixtures.length = 0;
    this.nextAssetCeilingPoolUpdateAt = Number.NEGATIVE_INFINITY;
  }

  private setupBaishaGameplay(handle: InteriorAssetHandle): void {
    const gameplay = handle.meta?.baishaGameplay;
    if (this.roomKind !== "dorm" || !gameplay) return;

    this.clearBaishaGameplay();
    this.baishaGameplayPhase = "photo";
    this.baishaTriggeredPhase = undefined;
    this.baishaGhostState = "dormant";
    this.baishaChaseArmed = false;
    this.baishaChaseBranch = "shortcut";
    this.baishaChasePathIndex = 1;
    this.baishaShortcutPath = [];
    this.baishaPursuitPath = [];
    this.baishaPursuitPathIndex = 1;
    this.baishaNextRepathAt = Number.NEGATIVE_INFINITY;
    this.baishaLastPursuitTarget.set(Number.NaN, Number.NaN);
    this.baishaChaseTriggeredAt = Number.POSITIVE_INFINITY;
    this.baishaCaptureDisabledUntil = Number.POSITIVE_INFINITY;
    this.baishaHalfSpeedUntil = Number.NEGATIVE_INFINITY;
    this.baishaTrueExitOpen = false;
    this.baishaPlayerReachedTriangle = false;
    this.baishaCaptureReported = false;
    this.baishaExitReported = false;
    this.baishaEnergyActive = false;
    this.baishaAutoSprintRecovering = false;
    this.baishaDebugEnergyChecked = false;
    this.baishaPreExitColliders = undefined;
    this.baishaPreExitMapObstacles = undefined;
    this.baishaDebugDoorChecked = false;
    this.baishaDoorCollider = { ...gameplay.door.collisionBounds };
    this.colliders.push(this.baishaDoorCollider);

    for (const name of gameplay.computer.visualNames ?? []) {
      const visual = getInteriorAssetObject(handle.root, name);
      visual?.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const cloned = sourceMaterials.map((source) => source.clone());
        mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
        for (const material of cloned) {
          const standard = material as THREE.MeshStandardMaterial;
          if (!standard.emissive) continue;
          this.baishaComputerMaterials.push({
            material: standard,
            emissive: standard.emissive.clone(),
            emissiveIntensity: standard.emissiveIntensity,
            color: standard.color.clone(),
          });
        }
      });
    }

    this.baishaComputerLight = new THREE.PointLight(0xf00618, 0, 5.6, 1.55);
    this.baishaComputerLight.name = "baisha_computer_red_light";
    this.baishaComputerLight.position.set(gameplay.computer.x, gameplay.computer.y, gameplay.computer.z);
    this.scene.add(this.baishaComputerLight);
    this.setBaishaComputerGlow(false);

    const chase = gameplay.chase;
    if (chase) {
      this.baishaGhostVisual = getInteriorAssetObject(handle.root, chase.ghostVisualName);
      this.baishaShortcutPath = this.getBaishaShortcutPath();
      const start = this.baishaShortcutPath[0] ?? gameplay.chasePrep?.ghost;
      if (start) this.setBaishaGhostPosition(start.x, start.z);
    }
  }

  private clearBaishaGameplay(): void {
    if (this.baishaComputerLight) this.scene.remove(this.baishaComputerLight);
    this.baishaComputerLight = undefined;
    this.baishaComputerMaterials.length = 0;
    this.baishaDoorCollider = undefined;
    this.baishaTriggeredPhase = undefined;
    this.baishaGameplayPhase = "photo";
    this.baishaGhostState = "dormant";
    this.baishaChaseArmed = false;
    this.baishaGhostVisual = undefined;
    this.baishaChaseBranch = "shortcut";
    this.baishaChasePathIndex = 1;
    this.baishaShortcutPath = [];
    this.baishaPursuitPath = [];
    this.baishaPursuitPathIndex = 1;
    this.baishaNextRepathAt = Number.NEGATIVE_INFINITY;
    this.baishaLastPursuitTarget.set(Number.NaN, Number.NaN);
    this.baishaChaseTriggeredAt = Number.POSITIVE_INFINITY;
    this.baishaCaptureDisabledUntil = Number.POSITIVE_INFINITY;
    this.baishaHalfSpeedUntil = Number.NEGATIVE_INFINITY;
    this.baishaTrueExitOpen = false;
    this.baishaPlayerReachedTriangle = false;
    this.baishaCaptureReported = false;
    this.baishaExitReported = false;
    this.baishaEnergyActive = false;
    this.baishaAutoSprintRecovering = false;
    this.baishaDebugEnergyChecked = false;
    this.baishaPreExitColliders = undefined;
    this.baishaPreExitMapObstacles = undefined;
    this.baishaDebugDoorChecked = false;
    if (this.baishaShadowCacheEnabled) {
      this.baishaShadowCacheEnabled = false;
      this.renderer.shadowMap.autoUpdate = true;
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.gameplayPaused = false;
  }

  private updateBaishaShadowCache(): void {
    if (!this.baishaShadowCacheEnabled) return;
    if (
      this.camera.position.equals(this.baishaShadowCameraPosition)
      && this.camera.quaternion.equals(this.baishaShadowCameraQuaternion)
    ) return;
    this.baishaShadowCameraPosition.copy(this.camera.position);
    this.baishaShadowCameraQuaternion.copy(this.camera.quaternion);
    this.renderer.shadowMap.needsUpdate = true;
  }

  private setBaishaComputerGlow(active: boolean): void {
    if (this.baishaComputerLight) this.baishaComputerLight.intensity = active ? 7.2 : 0;
    for (const entry of this.baishaComputerMaterials) {
      entry.material.emissive.copy(active ? new THREE.Color(0xef0619) : entry.emissive);
      entry.material.emissiveIntensity = active ? 5.4 : entry.emissiveIntensity;
      entry.material.color.copy(active ? new THREE.Color(0x5f0710) : entry.color);
      entry.material.needsUpdate = true;
    }
  }

  private collectBaishaGameplayTrigger(): void {
    if (this.roomKind !== "dorm" || this.gameplayPaused) return;
    if (this.baishaGameplayPhase === "paused" || this.baishaGameplayPhase === "complete") return;
    const gameplay = this.assetHandle?.meta?.baishaGameplay;
    if (!gameplay) return;
    const phase = this.baishaGameplayPhase;
    const target = gameplay[phase];
    if (!target || this.baishaTriggeredPhase === phase) return;
    const dx = this.camera.position.x - target.x;
    const dz = this.camera.position.z - target.z;
    if (dx * dx + dz * dz > target.radius * target.radius) return;
    this.baishaTriggeredPhase = phase;
    this.ePressed = false;
    this.onBaishaTrigger?.(phase);
  }

  private updateBaishaChasePrep(): void {
    if (this.roomKind !== "dorm" || this.gameplayPaused || this.baishaGameplayPhase !== "complete") return;
    if (this.baishaGhostState === "chase") return;
    const config = this.assetHandle?.meta?.baishaGameplay?.chasePrep;
    if (!config) return;

    if (!this.baishaChaseArmed) {
      if (this.camera.position.z >= config.exitThresholdZ) return;
      this.baishaChaseArmed = true;
      this.baishaChaseExitOrigin.set(this.camera.position.x, this.camera.position.z);
    }

    this.baishaChaseViewPoint.set(config.ghost.x, config.ghost.y, config.ghost.z).project(this.camera);
    const dx = this.camera.position.x - config.ghost.x;
    const dz = this.camera.position.z - config.ghost.z;
    const ghostInView = dx * dx + dz * dz <= config.viewDistance * config.viewDistance
      && this.baishaChaseViewPoint.z >= -1
      && this.baishaChaseViewPoint.z <= 1
      && Math.abs(this.baishaChaseViewPoint.x) <= 0.92
      && Math.abs(this.baishaChaseViewPoint.y) <= 0.92;

    const fleeX = config.fleeDirectionX;
    const fleeZ = config.fleeDirectionZ;
    const fleeLength = Math.hypot(fleeX, fleeZ) || 1;
    const fledDistance = (
      (this.camera.position.x - this.baishaChaseExitOrigin.x) * fleeX
      + (this.camera.position.z - this.baishaChaseExitOrigin.y) * fleeZ
    ) / fleeLength;
    if (!ghostInView && fledDistance < config.fleeDistance) return;

    this.baishaGhostState = "chase";
    const now = this.clock.elapsedTime;
    const chase = this.assetHandle?.meta?.baishaGameplay?.chase;
    this.baishaChaseTriggeredAt = now;
    this.baishaCaptureDisabledUntil = now
      + (chase?.jumpscareDuration ?? 1.3)
      + (chase?.openingHoldSeconds ?? 1);
    this.baishaChaseBranch = "shortcut";
    this.baishaChasePathIndex = 1;
    this.baishaShortcutPath = this.getBaishaShortcutPath();
    this.baishaPursuitPath = [];
    this.baishaPursuitPathIndex = 1;
    this.baishaNextRepathAt = Number.NEGATIVE_INFINITY;
    this.baishaLastPursuitTarget.set(Number.NaN, Number.NaN);
    this.baishaAutoSprintRecovering = this.runtimeStamina <= 0;
    const next = this.baishaShortcutPath[1];
    if (next) this.faceBaishaGhostToward(next.x, next.z);
    this.moveCtx.sprintSpeed = this.blueprint.movement.sprintSpeed * (
      this.baishaEnergyActive ? BAISHA_ENERGY_SPRINT_MULTIPLIER : BAISHA_CHASE_SPRINT_MULTIPLIER
    );
    this.baishaLightningUntil = now + 0.28;
    this.nextBaishaLightningAt = now + 7 + Math.random() * 2;
    playBaishaThunder();
    this.onBaishaChaseStart?.();
  }

  private updateBaishaChase(dt: number): void {
    if (this.roomKind !== "dorm" || this.gameplayPaused || this.baishaGhostState !== "chase") return;
    if (this.baishaCaptureReported || this.baishaExitReported) return;
    const chase = this.assetHandle?.meta?.baishaGameplay?.chase;
    if (!chase || !this.baishaGhostVisual) return;

    const playerX = this.camera.position.x;
    const playerZ = this.camera.position.z;
    const triangleDistance = Math.hypot(playerX - chase.triangle.x, playerZ - chase.triangle.z);
    const unlockZone = chase.trueExit.unlockZone;
    const reachedUnlockZone = unlockZone
      ? playerX >= unlockZone.minX
        && playerX <= unlockZone.maxX
        && playerZ >= unlockZone.minZ
        && playerZ <= unlockZone.maxZ
      : triangleDistance <= chase.triangle.radius;
    if (!this.baishaPlayerReachedTriangle && reachedUnlockZone) {
      this.baishaPlayerReachedTriangle = true;
      this.openBaishaTrueExit();
    }

    const now = this.clock.elapsedTime;
    const movementStart = this.baishaChaseTriggeredAt + chase.jumpscareDuration;
    const holdEnd = movementStart + chase.openingHoldSeconds;
    const openingHalfEnd = holdEnd + chase.openingHalfSpeedSeconds;
    let speedFactor = now < holdEnd ? 0 : now < openingHalfEnd ? 0.5 : 1;
    if (now < this.baishaHalfSpeedUntil) speedFactor = Math.min(speedFactor, 0.5);

    const travelDistance = chase.fullSpeed * speedFactor * dt;
    if (this.baishaChaseBranch === "shortcut") {
      if (speedFactor > 0) this.advanceBaishaGhost(this.baishaShortcutPath, travelDistance);
      if (this.baishaChasePathIndex >= this.baishaShortcutPath.length) {
        // The only forced portion of the chase is the verified white-marked
        // doorway and the corridor between the two long partitions. Once the
        // ghost reaches the shortcut outlet, every following turn is selected
        // from the live player position on the authored walkable graph.
        this.baishaChaseBranch = "pursuit";
        this.baishaPursuitPath = [];
        this.baishaPursuitPathIndex = 1;
        this.baishaNextRepathAt = Number.NEGATIVE_INFINITY;
        this.baishaLastPursuitTarget.set(Number.NaN, Number.NaN);
        if (!this.baishaPlayerReachedTriangle) {
          this.baishaCaptureDisabledUntil = now + chase.encounterGraceSeconds;
          this.baishaHalfSpeedUntil = now + chase.encounterHalfSpeedSeconds;
          this.openBaishaTrueExit();
        }
      }
    } else if (speedFactor > 0) {
      this.advanceBaishaGhostPursuit(playerX, playerZ, travelDistance, now);
    }

    const playerDistance = Math.hypot(playerX - this.baishaGhostPosition.x, playerZ - this.baishaGhostPosition.y);

    const exit = chase.trueExit.trigger;
    const exitDistance = Math.hypot(playerX - exit.x, playerZ - exit.z);
    if (this.baishaTrueExitOpen && exitDistance <= exit.radius) {
      this.baishaExitReported = true;
      this.gameplayPaused = true;
      this.inputManager.reset();
      this.onBaishaExit?.();
      return;
    }

    if (
      now >= this.baishaCaptureDisabledUntil
      && playerDistance <= chase.captureDistance
      && this.isBaishaLineOfSightClear(playerX, playerZ)
    ) {
      this.baishaCaptureReported = true;
      this.gameplayPaused = true;
      this.inputManager.reset();
      this.moveCtx.velocity.x = 0;
      this.moveCtx.velocity.y = 0;
      this.onBaishaCapture?.();
    }
  }

  private getBaishaShortcutPath(): Array<{ x: number; z: number }> {
    const navigation = this.assetHandle?.meta?.baishaGameplay?.chase?.navigation;
    if (!navigation) return [];
    const nodes = new Map(navigation.nodes.map((node) => [node.id, node]));
    return navigation.shortcutNodeIds.flatMap((id) => {
      const node = nodes.get(id);
      return node ? [{ x: node.x, z: node.z }] : [];
    });
  }

  private advanceBaishaGhost(path: Array<{ x: number; z: number }>, distance: number): void {
    if (path.length === 0 || distance <= 0) return;
    let remaining = distance;
    while (remaining > 0 && this.baishaChasePathIndex < path.length) {
      const target = path[this.baishaChasePathIndex];
      const dx = target.x - this.baishaGhostPosition.x;
      const dz = target.z - this.baishaGhostPosition.y;
      const length = Math.hypot(dx, dz);
      if (length <= 0.001) {
        this.baishaChasePathIndex++;
        continue;
      }
      const step = Math.min(remaining, length);
      this.setBaishaGhostPosition(
        this.baishaGhostPosition.x + dx / length * step,
        this.baishaGhostPosition.y + dz / length * step,
      );
      remaining -= step;
      if (step >= length - 0.001) this.baishaChasePathIndex++;
    }
  }

  private advanceBaishaGhostPursuit(playerX: number, playerZ: number, distance: number, now: number): void {
    const chase = this.assetHandle?.meta?.baishaGameplay?.chase;
    if (!chase) return;
    const targetMoved = !Number.isFinite(this.baishaLastPursuitTarget.x)
      || this.baishaLastPursuitTarget.distanceToSquared(new THREE.Vector2(playerX, playerZ)) > 0.64;
    const pathFinished = this.baishaPursuitPathIndex >= this.baishaPursuitPath.length;
    if (pathFinished || targetMoved || now >= this.baishaNextRepathAt) {
      const nextPath = this.findBaishaPursuitPath(playerX, playerZ);
      // Never keep following a stale route after a repath. If the player is
      // already on the same projected graph point the route legitimately has
      // fewer than two points and the ghost should wait for the next live
      // projection, not continue toward an obsolete corner.
      this.baishaPursuitPath = nextPath;
      this.baishaPursuitPathIndex = nextPath.length >= 2 ? 1 : nextPath.length;
      this.baishaLastPursuitTarget.set(playerX, playerZ);
      this.baishaNextRepathAt = now + (chase.repathSeconds ?? 0.28);
    }

    let remaining = distance;
    while (remaining > 0 && this.baishaPursuitPathIndex < this.baishaPursuitPath.length) {
      const target = this.baishaPursuitPath[this.baishaPursuitPathIndex];
      const dx = target.x - this.baishaGhostPosition.x;
      const dz = target.z - this.baishaGhostPosition.y;
      const length = Math.hypot(dx, dz);
      if (length <= 0.001) {
        this.baishaPursuitPathIndex++;
        continue;
      }
      const step = Math.min(remaining, length);
      this.setBaishaGhostPosition(
        this.baishaGhostPosition.x + dx / length * step,
        this.baishaGhostPosition.y + dz / length * step,
      );
      remaining -= step;
      if (step >= length - 0.001) this.baishaPursuitPathIndex++;
    }
  }

  /**
   * Route on the authored corridor graph instead of the raw collision grid.
   * The graph contains only walkable centre-lines, so doors and 90-degree
   * corridor turns stay semantically stable even when the GLB is re-batched.
   */
  private findBaishaPursuitPath(playerX: number, playerZ: number): Array<{ x: number; z: number }> {
    const chase = this.assetHandle?.meta?.baishaGameplay?.chase;
    const navigation = chase?.navigation;
    if (!navigation || navigation.nodes.length === 0) return [];

    type GraphPoint = { x: number; z: number };
    type ActiveEdge = {
      from: number;
      to: number;
      length: number;
      targetable: boolean;
    };
    const points: GraphPoint[] = navigation.nodes.map(({ x, z }) => ({ x, z }));
    const nodeIndices = new Map(navigation.nodes.map((node, index) => [node.id, index]));
    const edges: ActiveEdge[] = navigation.edges.flatMap((edge) => {
      if (edge.requiresExitOpen && !this.baishaTrueExitOpen) return [];
      const from = nodeIndices.get(edge.from);
      const to = nodeIndices.get(edge.to);
      if (from === undefined || to === undefined) return [];
      const a = points[from];
      const b = points[to];
      return [{
        from,
        to,
        length: Math.hypot(b.x - a.x, b.z - a.z),
        targetable: edge.targetable !== false,
      }];
    });
    if (edges.length === 0) return [];

    const project = (x: number, z: number, targetOnly: boolean) => {
      let best: { edgeIndex: number; x: number; z: number; t: number; distance: number } | undefined;
      edges.forEach((edge, edgeIndex) => {
        if (targetOnly && !edge.targetable) return;
        const a = points[edge.from];
        const b = points[edge.to];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const lengthSquared = dx * dx + dz * dz;
        const t = lengthSquared > 0
          ? THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / lengthSquared, 0, 1)
          : 0;
        const projectedX = a.x + dx * t;
        const projectedZ = a.z + dz * t;
        const distance = Math.hypot(x - projectedX, z - projectedZ);
        if (!best || distance < best.distance) {
          best = { edgeIndex, x: projectedX, z: projectedZ, t, distance };
        }
      });
      return best;
    };

    const startProjection = project(this.baishaGhostPosition.x, this.baishaGhostPosition.y, false);
    const goalProjection = project(playerX, playerZ, true);
    if (!startProjection || !goalProjection) return [];

    const adjacency: Array<Array<{ to: number; weight: number }>> = points.map(() => []);
    const addUndirected = (from: number, to: number, weight: number): void => {
      adjacency[from].push({ to, weight });
      adjacency[to].push({ to: from, weight });
    };
    for (const edge of edges) addUndirected(edge.from, edge.to, edge.length);

    const appendPoint = (point: GraphPoint): number => {
      points.push(point);
      adjacency.push([]);
      return points.length - 1;
    };
    const startIndex = appendPoint({ x: this.baishaGhostPosition.x, z: this.baishaGhostPosition.y });
    const startProjectionIndex = appendPoint({ x: startProjection.x, z: startProjection.z });
    const goalProjectionIndex = appendPoint({ x: goalProjection.x, z: goalProjection.z });
    const goalIndex = appendPoint({ x: playerX, z: playerZ });
    addUndirected(startIndex, startProjectionIndex, startProjection.distance);
    addUndirected(goalProjectionIndex, goalIndex, goalProjection.distance);

    const connectProjection = (
      projectionIndex: number,
      projection: NonNullable<typeof startProjection>,
    ): void => {
      const edge = edges[projection.edgeIndex];
      addUndirected(projectionIndex, edge.from, projection.t * edge.length);
      addUndirected(projectionIndex, edge.to, (1 - projection.t) * edge.length);
    };
    connectProjection(startProjectionIndex, startProjection);
    connectProjection(goalProjectionIndex, goalProjection);
    if (startProjection.edgeIndex === goalProjection.edgeIndex) {
      const edge = edges[startProjection.edgeIndex];
      addUndirected(
        startProjectionIndex,
        goalProjectionIndex,
        Math.abs(startProjection.t - goalProjection.t) * edge.length,
      );
    }

    const distances = new Float64Array(points.length);
    distances.fill(Number.POSITIVE_INFINITY);
    distances[startIndex] = 0;
    const parents = new Int32Array(points.length);
    parents.fill(-1);
    const visited = new Uint8Array(points.length);
    for (let iteration = 0; iteration < points.length; iteration++) {
      let current = -1;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < points.length; index++) {
        if (!visited[index] && distances[index] < bestDistance) {
          current = index;
          bestDistance = distances[index];
        }
      }
      if (current < 0 || current === goalIndex) break;
      visited[current] = 1;
      for (const edge of adjacency[current]) {
        const candidate = distances[current] + edge.weight;
        if (candidate >= distances[edge.to]) continue;
        distances[edge.to] = candidate;
        parents[edge.to] = current;
      }
    }
    if (!Number.isFinite(distances[goalIndex])) return [];

    const routeIndices: number[] = [];
    for (let current = goalIndex; current >= 0; current = parents[current]) routeIndices.push(current);
    routeIndices.reverse();
    const route = routeIndices.map((index) => points[index]);
    const compact: GraphPoint[] = [];
    for (const point of route) {
      const last = compact[compact.length - 1];
      if (last && Math.hypot(point.x - last.x, point.z - last.z) <= 0.001) continue;
      if (compact.length >= 2) {
        const before = compact[compact.length - 2];
        const ax = last.x - before.x;
        const az = last.z - before.z;
        const bx = point.x - last.x;
        const bz = point.z - last.z;
        const collinear = Math.abs(ax * bz - az * bx) <= 0.001;
        const sameDirection = ax * bx + az * bz >= 0;
        if (collinear && sameDirection) {
          compact[compact.length - 1] = point;
          continue;
        }
      }
      compact.push(point);
    }
    return compact;
  }

  private faceBaishaGhostToward(x: number, z: number): void {
    if (!this.baishaGhostVisual) return;
    const dx = x - this.baishaGhostPosition.x;
    const dz = z - this.baishaGhostPosition.y;
    if (dx * dx + dz * dz <= 0.000001) return;
    const yawOffset = this.assetHandle?.meta?.baishaGameplay?.chase?.ghostYawOffset ?? Math.PI / 2;
    this.baishaGhostVisual.rotation.y = Math.atan2(dx, dz) + yawOffset;
  }

  private setBaishaGhostPosition(x: number, z: number): void {
    const previousX = this.baishaGhostPosition.x;
    const previousZ = this.baishaGhostPosition.y;
    this.baishaGhostPosition.set(x, z);
    if (!this.baishaGhostVisual) return;
    this.baishaGhostVisual.position.x = x;
    this.baishaGhostVisual.position.z = z;
    const dx = x - previousX;
    const dz = z - previousZ;
    if (this.baishaGhostState === "chase" && dx * dx + dz * dz > 0.000001) {
      const yawOffset = this.assetHandle?.meta?.baishaGameplay?.chase?.ghostYawOffset ?? Math.PI / 2;
      this.baishaGhostVisual.rotation.y = Math.atan2(dx, dz) + yawOffset;
    }
    this.baishaGhostVisual.updateMatrixWorld(true);
  }

  private openBaishaTrueExit(): void {
    if (this.baishaTrueExitOpen) return;
    const chase = this.assetHandle?.meta?.baishaGameplay?.chase;
    if (!chase) return;
    this.baishaTrueExitOpen = true;
    this.baishaPreExitColliders = this.colliders;
    this.baishaPreExitMapObstacles = this.interiorMapObstacles;

    for (const name of chase.trueExit.visualNames) {
      const visual = this.assetHandle ? getInteriorAssetObject(this.assetHandle.root, name) : undefined;
      if (visual) visual.visible = false;
    }
    this.colliders = chase.trueExit.clearZones.reduce<AABB[]>((colliders, zone) => (
      colliders.flatMap((collider) => cutObstacleByClearZone(
        { ...collider, kind: "wall" },
        zone,
      ).map(({ kind: _kind, ...piece }) => piece))
    ), this.colliders);
    if (this.interiorMapObstacles) {
      this.interiorMapObstacles = chase.trueExit.clearZones.reduce<InteriorMapObstacle[]>((obstacles, zone) => (
        obstacles.flatMap((obstacle) => cutObstacleByClearZone(obstacle, zone))
      ), this.interiorMapObstacles);
    }
    if (this.baishaShadowCacheEnabled) this.renderer.shadowMap.needsUpdate = true;
  }

  private restoreBaishaTrueExit(): void {
    const chase = this.assetHandle?.meta?.baishaGameplay?.chase;
    if (!chase) return;
    for (const name of chase.trueExit.visualNames) {
      const visual = this.assetHandle ? getInteriorAssetObject(this.assetHandle.root, name) : undefined;
      if (visual) visual.visible = true;
    }
    if (this.baishaPreExitColliders) this.colliders = this.baishaPreExitColliders;
    if (this.baishaPreExitMapObstacles) this.interiorMapObstacles = this.baishaPreExitMapObstacles;
    this.baishaPreExitColliders = undefined;
    this.baishaPreExitMapObstacles = undefined;
    this.baishaTrueExitOpen = false;
  }

  private isBaishaLineOfSightClear(playerX: number, playerZ: number): boolean {
    const dx = playerX - this.baishaGhostPosition.x;
    const dz = playerZ - this.baishaGhostPosition.y;
    for (let sample = 1; sample < 5; sample++) {
      const amount = sample / 5;
      const x = this.baishaGhostPosition.x + dx * amount;
      const z = this.baishaGhostPosition.y + dz * amount;
      if (this.colliders.some((collider) => (
        (!collider.isActive || collider.isActive())
        && x >= collider.minX
        && x <= collider.maxX
        && z >= collider.minZ
        && z <= collider.maxZ
      ))) return false;
    }
    return true;
  }

  private addBaishaLighting(handle: InteriorAssetHandle): void {
    const config = handle.meta?.baishaLighting;
    if (this.roomKind !== "dorm" || !config) return;

    this.clearBaishaLighting();
    this.baishaRevealAhead = config.revealAhead ?? 3;
    const boundaryWalls = handle.meta?.baishaBoundaryWalls ?? [];
    if (boundaryWalls.length > 0) {
      const group = new THREE.Group();
      group.name = "baisha_boundary_wall_repairs";
      const material = new THREE.MeshStandardMaterial({
        color: 0x170b0c,
        roughness: 0.96,
        metalness: 0,
      });
      for (const wall of boundaryWalls) {
        if (wall.visible === false) continue;
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(
            wall.maxX - wall.minX,
            wall.topY - wall.baseY,
            wall.maxZ - wall.minZ,
          ),
          material,
        );
        mesh.position.set(
          (wall.minX + wall.maxX) * 0.5,
          wall.baseY + (wall.topY - wall.baseY) * 0.5,
          (wall.minZ + wall.maxZ) * 0.5,
        );
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      this.scene.add(group);
      this.baishaBoundaryWalls = group;
    }
    const raisedCeiling = handle.meta?.baishaRaisedCeiling;
    if (raisedCeiling) {
      const { minX, maxX, minZ, maxZ, baseY, raisedY } = raisedCeiling;
      const width = maxX - minX;
      const depth = maxZ - minZ;
      const lift = raisedY - baseY;
      const group = new THREE.Group();
      group.name = "baisha_raised_shortcut_ceiling";
      const material = new THREE.MeshStandardMaterial({
        color: 0x130a0b,
        roughness: 0.96,
        metalness: 0,
      });
      const addPanel = (geometry: THREE.BoxGeometry, x: number, y: number, z: number): void => {
        const panel = new THREE.Mesh(geometry, material);
        panel.position.set(x, y, z);
        panel.castShadow = true;
        panel.receiveShadow = true;
        group.add(panel);
      };
      addPanel(new THREE.BoxGeometry(width, 0.14, depth), (minX + maxX) * 0.5, raisedY, (minZ + maxZ) * 0.5);
      addPanel(new THREE.BoxGeometry(0.14, lift, depth), minX, baseY + lift * 0.5, (minZ + maxZ) * 0.5);
      addPanel(new THREE.BoxGeometry(0.14, lift, depth), maxX, baseY + lift * 0.5, (minZ + maxZ) * 0.5);
      addPanel(new THREE.BoxGeometry(width, lift, 0.14), (minX + maxX) * 0.5, baseY + lift * 0.5, minZ);
      addPanel(new THREE.BoxGeometry(width, lift, 0.14), (minX + maxX) * 0.5, baseY + lift * 0.5, maxZ);
      this.scene.add(group);
      this.baishaRaisedCeiling = group;
    }
    this.baishaTubeGeometry = new THREE.BoxGeometry(2.35, 0.045, 0.075);
    this.baishaHousingGeometry = new THREE.BoxGeometry(2.55, 0.1, 0.2);
    this.baishaHousingMaterial = new THREE.MeshStandardMaterial({
      color: 0x180507,
      roughness: 0.58,
      metalness: 0.42,
    });

    let corridorIndex = 0;
    config.fixtures.forEach((fixture) => {
      const group = new THREE.Group();
      group.name = `baisha_fluorescent_${fixture.id}`;
      group.position.set(fixture.x, fixture.y, fixture.z);
      if (fixture.axis === "z") group.rotation.y = Math.PI / 2;

      const housing = new THREE.Mesh(this.baishaHousingGeometry!, this.baishaHousingMaterial!);
      housing.castShadow = true;
      housing.receiveShadow = true;
      group.add(housing);

      const material = new THREE.MeshStandardMaterial({
        color: 0x6e0710,
        emissive: 0xb20d18,
        emissiveIntensity: 4.2,
        roughness: 0.24,
        metalness: 0.08,
      });
      const tube = new THREE.Mesh(this.baishaTubeGeometry!, material);
      tube.position.y = -0.075;
      group.add(tube);
      this.scene.add(group);

      const isCorridor = fixture.zone === "corridor";
      this.baishaTubes.push({
        group,
        material,
        position: new THREE.Vector3(fixture.x, fixture.y - 0.18, fixture.z),
        zone: fixture.zone,
        corridorIndex: isCorridor ? corridorIndex++ : -1,
        active: !isCorridor,
        intensity: 0,
      });
    });

    const windowConfig = handle.meta?.baishaCorridorWindow;
    if (windowConfig) {
      const windowGroup = new THREE.Group();
      windowGroup.name = "baisha_corridor_window";
      const frameMaterial = new THREE.MeshStandardMaterial({
        color: 0x16090b,
        roughness: 0.74,
        metalness: 0.38,
      });
      const addFrame = (geometry: THREE.BoxGeometry, px: number, py: number, pz: number): void => {
        const frame = new THREE.Mesh(geometry, frameMaterial);
        frame.position.set(px, py, pz);
        frame.castShadow = true;
        frame.receiveShadow = true;
        windowGroup.add(frame);
      };
      const halfWidth = windowConfig.width * 0.5;
      const halfHeight = windowConfig.height * 0.5;
      const frameX = windowConfig.x - 0.18;
      addFrame(
        new THREE.BoxGeometry(0.16, windowConfig.height + 0.18, 0.12),
        frameX,
        windowConfig.y,
        windowConfig.z - halfWidth,
      );
      addFrame(
        new THREE.BoxGeometry(0.16, windowConfig.height + 0.18, 0.12),
        frameX,
        windowConfig.y,
        windowConfig.z + halfWidth,
      );
      addFrame(
        new THREE.BoxGeometry(0.16, 0.12, windowConfig.width + 0.18),
        frameX,
        windowConfig.y - halfHeight,
        windowConfig.z,
      );
      addFrame(
        new THREE.BoxGeometry(0.16, 0.12, windowConfig.width + 0.18),
        frameX,
        windowConfig.y + halfHeight,
        windowConfig.z,
      );
      addFrame(
        new THREE.BoxGeometry(0.13, windowConfig.height, 0.075),
        frameX - 0.015,
        windowConfig.y,
        windowConfig.z,
      );

      this.baishaCorridorWindowGlass = new THREE.MeshStandardMaterial({
        color: 0x100306,
        emissive: 0x240207,
        emissiveIntensity: 0.38,
        roughness: 0.2,
        metalness: 0.04,
        transparent: true,
        opacity: 0.78,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const glass = new THREE.Mesh(
        new THREE.PlaneGeometry(windowConfig.width - 0.08, windowConfig.height - 0.08),
        this.baishaCorridorWindowGlass,
      );
      glass.name = "baisha_corridor_window_glass";
      glass.position.set(windowConfig.x - 0.16, windowConfig.y, windowConfig.z);
      glass.rotation.y = Math.PI / 2;
      windowGroup.add(glass);
      this.scene.add(windowGroup);
      this.baishaCorridorWindow = windowGroup;

      this.baishaCorridorWindowFlash = new THREE.PointLight(0xdce8ff, 0, 10.5, 1.65);
      this.baishaCorridorWindowFlash.position.set(
        windowConfig.x - 0.72,
        windowConfig.y,
        windowConfig.z,
      );
      this.scene.add(this.baishaCorridorWindowFlash);
    }

    // A small moving pool lights the fixtures visible around the player. Every
    // passed tube remains emissive, but the shader never pays for dozens of
    // simultaneous point lights down corridors hidden behind walls.
    for (let index = 0; index < 6; index++) {
      const light = new THREE.PointLight(0xb70d1a, 0, 8.2, 1.72);
      light.name = `baisha_tube_pool_${index}`;
      light.visible = false;
      this.scene.add(light);
      this.baishaLightPool.push(light);
    }

    if (config.lightning) {
      const flash = config.lightning;
      this.baishaLightningTarget = new THREE.Object3D();
      this.baishaLightningTarget.position.set(flash.targetX, flash.targetY, flash.targetZ);
      this.scene.add(this.baishaLightningTarget);
      this.baishaLightning = new THREE.SpotLight(0xd8e5ff, 0, 24, Math.PI / 3.1, 0.72, 1.35);
      this.baishaLightning.position.set(flash.x, flash.y, flash.z);
      this.baishaLightning.target = this.baishaLightningTarget;
      if (!this.isMobile) {
        this.baishaLightning.castShadow = true;
        this.baishaLightning.shadow.mapSize.set(1024, 1024);
        this.baishaLightning.shadow.camera.near = 0.3;
        this.baishaLightning.shadow.camera.far = 24;
      }
      this.scene.add(this.baishaLightning);
      this.nextBaishaLightningAt = this.clock.elapsedTime + 7 + Math.random() * 2;
    }
    this.updateBaishaLighting(this.clock.elapsedTime, true);
  }

  private clearBaishaLighting(): void {
    for (const fixture of this.baishaTubes) {
      this.scene.remove(fixture.group);
      fixture.material.dispose();
    }
    this.baishaTubes.length = 0;
    for (const light of this.baishaLightPool) this.scene.remove(light);
    this.baishaLightPool.length = 0;
    if (this.baishaLightning) this.scene.remove(this.baishaLightning);
    if (this.baishaLightningTarget) this.scene.remove(this.baishaLightningTarget);
    if (this.baishaCorridorWindow) {
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      this.baishaCorridorWindow.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        geometries.add(mesh.geometry);
        const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of meshMaterials) materials.add(material);
      });
      this.scene.remove(this.baishaCorridorWindow);
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    }
    if (this.baishaCorridorWindowFlash) this.scene.remove(this.baishaCorridorWindowFlash);
    if (this.baishaBoundaryWalls) {
      const materials = new Set<THREE.Material>();
      this.baishaBoundaryWalls.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of meshMaterials) materials.add(material);
      });
      for (const material of materials) material.dispose();
      this.scene.remove(this.baishaBoundaryWalls);
      this.baishaBoundaryWalls = undefined;
    }
    if (this.baishaRaisedCeiling) {
      const materials = new Set<THREE.Material>();
      this.baishaRaisedCeiling.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of meshMaterials) materials.add(material);
      });
      for (const material of materials) material.dispose();
      this.scene.remove(this.baishaRaisedCeiling);
      this.baishaRaisedCeiling = undefined;
    }
    this.baishaLightning = undefined;
    this.baishaLightningTarget = undefined;
    this.baishaCorridorWindow = undefined;
    this.baishaCorridorWindowGlass = undefined;
    this.baishaCorridorWindowFlash = undefined;
    this.baishaTubeGeometry?.dispose();
    this.baishaHousingGeometry?.dispose();
    this.baishaHousingMaterial?.dispose();
    this.baishaTubeGeometry = undefined;
    this.baishaHousingGeometry = undefined;
    this.baishaHousingMaterial = undefined;
    this.baishaCorridorProgress = -1;
    this.nextBaishaLightningAt = Number.POSITIVE_INFINITY;
    this.baishaLightningUntil = 0;
  }

  private updateBaishaLighting(t: number, force = false): void {
    if (this.baishaTubes.length === 0) return;
    if (!force && t < this.nextBaishaLightingUpdateAt) return;
    this.nextBaishaLightingUpdateAt = t + 1 / 12;

    let nearestCorridor: BaishaTubeRuntime | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const fixture of this.baishaTubes) {
      if (fixture.zone !== "corridor") continue;
      const distance = Math.hypot(
        this.camera.position.x - fixture.position.x,
        this.camera.position.z - fixture.position.z,
      );
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestCorridor = fixture;
      }
    }
    if (nearestCorridor && nearestDistance < 2.8) {
      this.baishaCorridorProgress = Math.max(this.baishaCorridorProgress, nearestCorridor.corridorIndex);
    }

    const litFixtures: BaishaTubeRuntime[] = [];
    for (const fixture of this.baishaTubes) {
      const active = fixture.zone !== "corridor"
        || fixture.corridorIndex <= this.baishaCorridorProgress + this.baishaRevealAhead;
      const intensity = active ? 4.7 : 0.015;
      fixture.active = active;
      fixture.intensity = intensity;
      fixture.material.emissiveIntensity = intensity;
      fixture.material.color.setHex(active ? 0x700812 : 0x190306);
      if (active) litFixtures.push(fixture);
    }

    litFixtures.sort((a, b) => (
      this.camera.position.distanceToSquared(a.position) - this.camera.position.distanceToSquared(b.position)
    ));
    for (let index = 0; index < this.baishaLightPool.length; index++) {
      const light = this.baishaLightPool[index];
      const fixture = litFixtures[index];
      if (!fixture) {
        light.visible = false;
        light.intensity = 0;
        continue;
      }
      light.visible = true;
      light.position.copy(fixture.position);
      light.intensity = fixture.intensity * 0.92;
    }

    if (!this.baishaLightning) return;
    if (t >= this.nextBaishaLightningAt) {
      this.baishaLightningUntil = t + 0.16;
      this.nextBaishaLightningAt = t + 7 + Math.random() * 2;
      playLibraryThunder(0.12 + Math.random() * 0.16);
    }
    const flashing = t < this.baishaLightningUntil;
    this.baishaLightning.intensity = flashing
      ? 68 + Math.max(0, Math.sin(t * 92)) * 32
      : 0;
    if (this.baishaCorridorWindowGlass) {
      this.baishaCorridorWindowGlass.emissive.setHex(flashing ? 0xdce8ff : 0x240207);
      this.baishaCorridorWindowGlass.emissiveIntensity = flashing ? 9.5 : 0.38;
    }
    if (this.baishaCorridorWindowFlash) {
      this.baishaCorridorWindowFlash.intensity = flashing ? 18 : 0;
    }
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
    // Review-only noclip lets the authored model be inspected before its
    // static door receives approved interaction/animation gameplay.
    if (this.visualReviewMode) return false;
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
    // Noclip review mode must skip penetration pushes too: collides() alone
    // returning false still left players shoved onto obstacle boundary lines.
    if (this.visualReviewMode) return;
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
      if (this.buildingId === "medical-college" && this.assetHandle && this.medicalSegment) {
        // Top starts the garage download. Once the story reaches the garage,
        // the same hook starts the basement download. Loading/switching the
        // visible level remains the future black-screen transition's job.
        this.preloadMedicalSegmentAfter(getMedicalInteriorSegment(sceneId));
      }
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
    const baishaProfile = this.roomKind === "dorm" && this.baishaTubes.length > 0;
    const medicalProfile = this.roomKind === "medical" && Boolean(this.assetHandle);
    // Medical is an intentional authored scene whose gameplay metadata has not
    // been mapped yet. It must not inherit the diagnostic 8x flashlight used
    // for genuinely unmapped model previews.
    const previewingUnmappedAsset = Boolean(this.assetHandle && !this.assetHandle.meta && !medicalProfile);
    const targetAmbient = medicalProfile
      ? hasFlashlight ? 1.65 : 1.35
      : previewingUnmappedAsset
      ? 0.32
      : baishaProfile ? 0.18
      : hasFlashlight ? (libraryProfile ? 0.34 : 0.85) : libraryProfile ? 0.18 : 0.22;
    const targetFill = medicalProfile
      ? hasFlashlight ? 0.85 : 0.68
      : previewingUnmappedAsset
      ? 0.18
      : baishaProfile ? 0.1
      : hasFlashlight ? (libraryProfile ? 0.22 : 0.55) : libraryProfile ? 0.11 : 0.14;
    const targetNear = medicalProfile
      ? hasFlashlight ? 0.38 : 0.3
      : previewingUnmappedAsset
      ? 0.25
      : baishaProfile ? 0.2
      : hasFlashlight ? (libraryProfile ? 0.18 : 0.85) : libraryProfile ? 0.24 : 0.24;
    const k = Math.min(1, dt * 6);

    this.ambientLight.intensity = THREE.MathUtils.lerp(this.ambientLight.intensity, targetAmbient, k);
    this.fillLight.intensity = THREE.MathUtils.lerp(this.fillLight.intensity, targetFill, k);
    this.nearFillLight.intensity = THREE.MathUtils.lerp(this.nearFillLight.intensity, targetNear, k);

    this.flashlight.visible = hasFlashlight || previewingUnmappedAsset;
    if (hasFlashlight || previewingUnmappedAsset) {
      this.flashlightSys.update(dt, t);
      if (previewingUnmappedAsset) this.flashlight.intensity *= 8;
      if (medicalProfile) this.flashlight.intensity *= 0.48;
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
    this.updateBaishaLighting(t);
    this.updateLibraryReturnPursuit(dt, t);
    this.outsideRedLight.visible = this.outsideRedLight.intensity > 0.01;
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
    this.outsideCeilingLight.visible = this.outsideCeilingLight.intensity > 0.01;
  }

  private updateLibraryCeilingLights(t: number): void {
    if (this.roomKind !== "library") return;
    if (this.fallRevealed && this.camera.position.z > 32) this.hasLeftShelfAfterFall = true;
    if (this.hasLeftShelfAfterFall && this.camera.position.z < 29.5) this.libraryReturnFlicker = true;

    if (t >= this.nextAssetCeilingPoolUpdateAt) {
      this.nextAssetCeilingPoolUpdateAt = t + 0.25;
      const nearestFixtures = this.assetCeilingFixtures
        .map((position, fixtureIndex) => ({
          position,
          fixtureIndex,
          distanceSq: this.camera.position.distanceToSquared(position),
        }))
        .sort((a, b) => a.distanceSq - b.distanceSq);
      for (let index = 0; index < this.assetCeilingLights.length; index++) {
        const fixture = nearestFixtures[index];
        const light = this.assetCeilingLights[index];
        light.position.copy(fixture.position);
        light.position.y -= 0.12;
        light.userData.fixtureIndex = fixture.fixtureIndex;
      }
    }

    for (let index = 0; index < this.assetCeilingLights.length; index++) {
      const light = this.assetCeilingLights[index];
      const fixtureIndex = Number(light.userData.fixtureIndex ?? index);
      if (!this.libraryReturnFlicker) {
        light.intensity = 4.75 + Math.sin(t * 1.7 + fixtureIndex * 0.83) * 0.22;
        continue;
      }
      const harsh = Math.sin(t * (13.5 + (fixtureIndex % 4) * 2.1) + fixtureIndex * 1.91);
      const dropout = harsh > 0.58 || Math.sin(t * 3.3 + fixtureIndex * 2.7) > 0.86;
      light.intensity = dropout ? 0.16 : 4.9 + Math.max(0, harsh) * 1.7;
    }
  }

  private updateLibraryReturnPursuit(dt: number, t: number): void {
    const active = this.roomKind === "library"
      && this.fallRevealed
      && this.libraryReturnFlicker
      && this.storySceneId === "dorm_baiqiu"
      && this.camera.position.z > 3.4;

    if (!active) {
      this.libraryPursuitLight.intensity = THREE.MathUtils.lerp(this.libraryPursuitLight.intensity, 0, 0.18);
      this.libraryPursuitLight.visible = false;
      this.lastPursuitZ = this.camera.position.z;
      this.pursuitDistance = 7.2;
      return;
    }

    this.libraryPursuitLight.visible = true;
    const dz = this.camera.position.z - this.lastPursuitZ;
    this.lastPursuitZ = this.camera.position.z;
    const movingTowardExit = dz < -0.018;
    const driftingBack = dz > 0.012;
    const pressure = driftingBack ? 1.75 : movingTowardExit ? -0.9 : 0.72;
    this.pursuitDistance = THREE.MathUtils.clamp(this.pursuitDistance - pressure * dt, 1.05, 7.2);

    this.libraryPursuitLight.position.set(
      this.camera.position.x + Math.sin(t * 2.1) * 0.35,
      this.camera.position.y - 0.08,
      Math.min(this.bounds.maxZ - 0.5, this.camera.position.z + this.pursuitDistance),
    );
    this.libraryPursuitLight.intensity = 1.4 + (7.2 - this.pursuitDistance) * 1.25;

    if (t >= this.nextPursuitWhisperAt) {
      this.nextPursuitWhisperAt = t + 5.4 + Math.random() * 2.6;
      JumpscarePipeline.trigger({
        context: "ghost_close",
        intensity: 0.42,
        duration: 780,
        sanityCost: 0,
      });
    }

    if (this.pursuitDistance <= 1.35 && t >= this.pursuitHitCooldownUntil) {
      this.pursuitHitCooldownUntil = t + 9.5;
      this.pursuitDistance = 5.8;
      const pushed = this.findNearestAssetClearPoint(new THREE.Vector3(
        this.camera.position.x,
        this.camera.position.y,
        Math.max(this.bounds.minZ + 0.8, this.camera.position.z - 2.4),
      ));
      this.camera.position.set(pushed.x, this.room.floorHeightAt(pushed.x, pushed.z) + this.crouchState.eyeHeight, pushed.z);
      window.dispatchEvent(new CustomEvent("zju-horror-ghost-hit", {
        detail: {
          type: "sanity",
          amount: -9,
        },
      }));
    }
  }

  private scheduleBloodFlash(t: number): void {
    this.nextBloodFlashAt = t + 5 + Math.random() * 3;
  }

  private updateBloodLight(t: number): void {
    if (!this.bloodLightEnabled) {
      this.bloodLight.visible = false;
      this.bloodLight.intensity = 0;
      return;
    }

    this.bloodLight.visible = true;

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
    if (this.gameplayPaused) {
      snap.moveX = 0;
      snap.moveZ = 0;
      snap.jumpPressed = false;
      snap.sprintHeld = false;
      snap.crouchHeld = false;
    }
    // The corridor sequence is an authored chase, so forward movement must
    // enter the run state without requiring an undocumented Shift press.
    // Stamina still gates running and keeps the drink's recovery meaningful.
    if (!this.gameplayPaused && this.baishaGhostState === "chase") {
      if (this.runtimeStamina <= 0) {
        this.baishaAutoSprintRecovering = true;
      } else if (
        this.baishaAutoSprintRecovering
        && this.runtimeStamina >= BAISHA_AUTOSPRINT_RECOVERY_STAMINA
      ) {
        this.baishaAutoSprintRecovering = false;
      }
      if (
        !this.baishaAutoSprintRecovering
        && snap.moveZ > 0.1
        && this.runtimeStamina > 0
      ) {
        snap.sprintHeld = true;
      }
    }
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
    // 9b. Baisha's approved sequence is proximity-only and drives one map target at a time.
    this.collectBaishaGameplayTrigger();
    // 9c. Start and advance the authored Baisha corridor chase.
    this.updateBaishaChasePrep();
    this.updateBaishaChase(dt);
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
      // Gameplay availability must not depend on whether a procedural glow or
      // imported model happens to be visible. Rendering and phase sync can
      // change independently; the authored phase plus taken/inventory state
      // are the interaction truth.
      if (
        item.taken
        || this.hasInventoryItem(item.itemId)
        || !this.isPickupAvailable(item, this.storySceneId)
      ) continue;
      const dx = p.x - item.position.x;
      const dz = p.z - item.position.z;
      if (this.isInteractionInRange(dx * dx + dz * dz, item.radius, PICKUP_AUTO_RADIUS_SCALE)) {
        item.taken = true;
        item.glow.visible = false;
        this.setAssetPickupVisualVisible(item.itemId, false);
        if (this.roomKind === "dorm" && item.itemId === "energy") {
          this.baishaEnergyActive = true;
          this.baishaAutoSprintRecovering = false;
          this.moveCtx.sprintSpeed = this.blueprint.movement.sprintSpeed * BAISHA_ENERGY_SPRINT_MULTIPLIER;
          this.runtimeStamina = Math.min(100, this.runtimeStamina + 30);
          const restoredStamina = Math.round(this.runtimeStamina);
          this.persistedStamina = restoredStamina;
          this.staminaStoreSyncElapsed = 0;
          this.setStamina?.(restoredStamina);
        }
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
      `Player: (${this.camera.position.x.toFixed(2)}, ${this.camera.position.y.toFixed(2)}, ${this.camera.position.z.toFixed(2)})`,
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
    this.updateBaishaShadowCache();

    this.cameraController.applyVisualBob();
    try {
      this.renderer.render(this.scene, this.camera);
    } finally {
      this.cameraController.clearVisualBob();
    }
    if (this.perfEnabled) this.reportPerformance(frameStartedAt);
  };
}
