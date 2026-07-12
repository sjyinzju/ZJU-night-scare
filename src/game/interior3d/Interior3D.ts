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
import { BaishaChaseController } from "./BaishaChaseController";
import { useGameStore } from "../store";

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
  /** Dedicated level completion callback. */
  onLevelExit?: (levelId: "baisha-dorm") => void;
  /** Dedicated level death callback. */
  onLevelDeath?: (levelId: "baisha-dorm") => void;
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
}

const PLAYER_RADIUS = 0.32;
const EYE_HEIGHT = 1.6;
const GUIDE_MAX_POINTS = 32;

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

  private room: RoomBuildResult;
  private readonly roomKind: RoomKind;
  private colliders: AABB[];
  private bounds: AABB;
  private readonly blueprint: InteriorBlueprint;
  private assetHandle?: InteriorAssetHandle;
  private readonly assetPickupVisuals = new Map<string, THREE.Object3D[]>();
  private readonly assetPhaseVisuals: Array<{ objects: THREE.Object3D[]; activeSceneIds: string[] }> = [];
  private readonly assetFlickerLights: Array<{
    light: THREE.PointLight;
    baseIntensity: number;
    speed: number;
    phase: number;
    y: number;
    followPickupId?: string;
  }> = [];
  private readonly onPickup?: (itemId: string, name: string) => void;
  private readonly onStoryTrigger?: (sceneId: string) => void;
  private readonly onExitTrigger?: () => void;
  private readonly onLevelExit?: (levelId: "baisha-dorm") => void;
  private readonly onLevelDeath?: (levelId: "baisha-dorm") => void;
  private readonly getStorySceneId?: () => string;
  private readonly getInventory?: () => string[];
  private readonly getStamina?: () => number;
  private readonly setStamina?: (value: number) => void;
  private lowStaminaWarning = false;
  private bloodLightEnabled = false;
  private bloodLightMaxIntensity = 4.8;
  private nextBloodFlashAt = 0;
  private bloodFlashUntil = 0;

  // ── New movement architecture ──
  private readonly inputManager: InputManager;
  private readonly cameraController: CameraController;
  private readonly stateMachine: MovementStateMachine;
  private readonly moveCtx: MovementContext;
  /** CrouchState reference kept to read the lerped eye height. */
  private readonly crouchState: CrouchState;

  private debugColliders?: THREE.Group;
  private guideLine?: THREE.Line;
  private baishaChase?: BaishaChaseController;

  private rafId = 0;
  private disposed = false;
  private pointerLocked = false;

  // Bound handlers (kept so they can be removed on dispose).
  private readonly onResize = () => this.resize();
  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.code === "F3") { e.preventDefault(); this.toggleColliderDebug(); return; }
    if (e.code === "KeyE") { e.preventDefault(); this.ePressed = true; return; }
    this.inputManager.handleKeyDown(e);
  };
  private readonly onKeyUp = (e: KeyboardEvent) => this.inputManager.handleKeyUp(e);
  private readonly onMouseMove = (e: MouseEvent) => this.handleMouseMove(e);
  private readonly onPointerLockChange = () => {
    this.pointerLocked = document.pointerLockElement === this.renderer.domElement;
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
    this.onLevelExit = options.onLevelExit;
    this.onLevelDeath = options.onLevelDeath;
    this.getStorySceneId = options.getStorySceneId;
    this.getInventory = options.getInventory;
    this.getStamina = options.getStamina;
    this.setStamina = options.setStamina;

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
    const isBaisha = options.buildingId === "dorm-baisha";
    this.ambientLight = new THREE.AmbientLight(isBaisha ? 0x3a2830 : 0x2a3038, isBaisha ? 1.6 : 0.85);
    this.scene.add(this.ambientLight);
    this.fillLight = new THREE.HemisphereLight(0x28303c, 0x0a0c10, isBaisha ? 1.0 : 0.55);
    this.scene.add(this.fillLight);

    // 近距离补光:跟随相机的一盏很弱、短射程点光,只照亮角色周围、脚下和近处墙壁。
    this.nearFillLight = new THREE.PointLight(isBaisha ? 0xd4b8b0 : 0xaeb6c6, isBaisha ? 1.4 : 0.85, 5.0, 2.0);
    this.nearFillLight.position.set(0, -0.2, 0.1);
    this.camera.add(this.nearFillLight);

    this.bloodLight = new THREE.PointLight(0x6a0505, 0, 13, 2.2);
    this.bloodLight.position.set(-1.25, 3.05, -4.75);
    this.scene.add(this.bloodLight);
    this.scheduleBloodFlash(0);

    // Flashlight follows the camera.
    this.flashlight = new THREE.SpotLight(0xfff2d0, 6.0, 20, Math.PI / 6, 0.4, 1.4);
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
    this.blueprint = getInteriorBlueprint(this.roomKind);
    if (options.buildingId === "dorm-baisha") useGameStore.getState().beginBaishaRun();
    this.room = buildRoom(this.roomKind, options.buildingId, useGameStore.getState().baishaRun.photoAnchor);
    this.scene.add(this.room.root);
    this.colliders = this.room.colliders;
    this.bounds = this.room.bounds;
    this.loadStaticInteriorAsset(options.buildingId);

    if (options.buildingId === "dorm-baisha") {
      this.baishaChase = new BaishaChaseController(this.scene, this.camera, {
        onPhotoReveal: () => this.onStoryTrigger?.("dorm_photo"),
        onLevelExit: () => this.onLevelExit?.("baisha-dorm"),
        onDeath: () => this.onLevelDeath?.("baisha-dorm"),
      });
    }

    // Spawn at the room's entrance, looking down the corridor (-Z).
    this.camera.position.copy(this.findClearSpawn(this.room.spawn));

    // ── Initialise movement systems ──
    this.inputManager = new InputManager();
    this.cameraController = new CameraController(this.camera, this.isMobile);
    this.cameraController.setYaw(this.blueprint.spawnYaw);

    this.moveCtx = createMovementContext(this.camera, this.blueprint.movement, {
      collidesAt: (x, _y, z) => this.collides(x, z),
      bounds: this.bounds,
      playerRadius: PLAYER_RADIUS,
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
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    this.renderer.domElement.removeEventListener("click", this.onCanvasClick);
    this.exitPointerLock();

    if (this.debugColliders) this.toggleColliderDebug();
    this.assetHandle?.dispose();
    this.assetHandle = undefined;
    this.assetPickupVisuals.clear();
    this.assetPhaseVisuals.length = 0;
    this.clearAssetFlickerLights();
    this.room.dispose();
    this.baishaChase?.dispose();
    this.baishaChase = undefined;
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
    try {
      const handle = await loadInteriorAsset({
        buildingId,
        roomKind: this.roomKind,
        isMobile: this.isMobile,
        renderer: this.renderer,
      });
      if (!handle) return;
      if (this.disposed) {
        handle.dispose();
        return;
      }

      this.assetHandle = handle;

      // 白沙宿舍模型原点偏移：Blender 中缩放后原点未归零，
      // 需要将宿舍地板中心移动到 (x≈-4.5, y≈0, z≈4) 附近。
      // 命名节点（GHOST_SLENDER 等）的 local position 需补偿根偏移。
      if (buildingId === "dorm-baisha") {
        const rx = -97, ry = -24.7, rz = -46;
        handle.root.position.set(rx, ry, rz);

        const reposition = (name: string, wx: number, wy: number, wz: number) => {
          const node = handle.root.getObjectByName(name);
          if (node) node.position.set(wx - rx, wy - ry, wz - rz);
        };
        // 世界坐标 → local position 补偿
        reposition("GHOST_SLENDER",             -8.5,  1.6, 11.5);
        reposition("GATE_SHORTCUT",             -6.0,  1.6, 16.0);
        reposition("PICKUP_PHOTOGRAPH_VISUAL",  -4.5,  0.8,  4.5);
        reposition("PICKUP_ENERGY_VISUAL",      10.0,  0.8, 22.0);
      }

      this.scene.add(handle.root);
      this.bindInteriorAssetMetadata(handle);
      this.baishaChase?.bindAsset(handle.root);
      this.setProceduralRoomVisualsVisible(false);
      window.dispatchEvent(new CustomEvent("zju-horror-interior-asset-state", {
        detail: {
          buildingId,
          roomKind: this.roomKind,
          loaded: true,
          assetVersion: handle.meta?.assetVersion,
        },
      }));
    } catch (err) {
      console.warn("[Interior3D] Failed to load static interior asset, using procedural fallback:", err);
      this.setProceduralRoomVisualsVisible(true);
      window.dispatchEvent(new CustomEvent("zju-horror-interior-asset-state", {
        detail: { buildingId, roomKind: this.roomKind, loaded: false },
      }));
    }
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
    this.assetPhaseVisuals.length = 0;
    this.clearAssetFlickerLights();
    this.applyAssetPickupSpots(handle);
    this.createAssetFlickerLights(handle);
    const pickupVisuals = handle.meta?.pickupVisuals ?? {};
    const phaseVisuals = handle.meta?.phaseVisuals ?? [];
    const visualNames = new Set([
      ...Object.values(pickupVisuals).flat(),
      ...phaseVisuals.flatMap((phaseVisual) => phaseVisual.names),
    ]);
    this.setProceduralStoryTriggerMarkersVisible(true);
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
      this.setProceduralPickupMarkerVisible(itemId, false);
      this.setAssetPickupVisualVisible(itemId, !this.hasInventoryItem(itemId));
    }

    for (const phaseVisual of phaseVisuals) {
      const objects = phaseVisual.names.flatMap((name) => matched.get(name) ?? []);
      if (objects.length === 0) continue;
      this.assetPhaseVisuals.push({ objects, activeSceneIds: phaseVisual.activeSceneIds });
    }
    this.syncAssetPhaseVisuals(this.getStorySceneId?.());
  }

  private applyAssetPickupSpots(handle: InteriorAssetHandle): void {
    const pickupSpots = handle.meta?.pickupSpots ?? {};
    for (const [itemId, spots] of Object.entries(pickupSpots)) {
      const pickup = this.room.pickups.find((p) => p.itemId === itemId);
      if (!pickup || spots.length === 0) continue;
      const clearSpots = spots.filter((spot) => !this.collides(spot.x, spot.z));
      const choices = clearSpots.length > 0 ? clearSpots : spots;
      const baishaPhoto = handle.meta?.buildingId === "dorm-baisha" && itemId === "photograph";
      const index = baishaPhoto
        ? useGameStore.getState().baishaRun.photoAnchor % choices.length
        : Math.floor(Math.random() * choices.length);
      const spot = choices[index];
      pickup.position.set(spot.x, pickup.position.y, spot.z);
      pickup.glow.position.set(spot.x, pickup.glow.position.y, spot.z);
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
    if (this.room.isWalkable && !this.room.isWalkable(x, z)) return true;
    for (const c of this.colliders) {
      if (!this.isColliderActive(c)) continue;
      if (
        x > c.minX - PLAYER_RADIUS &&
        x < c.maxX + PLAYER_RADIUS &&
        z > c.minZ - PLAYER_RADIUS &&
        z < c.maxZ + PLAYER_RADIUS
      ) {
        return true;
      }
    }
    return false;
  }

  private clampToBounds(value: number, min: number, max: number): number {
    return THREE.MathUtils.clamp(value, min + PLAYER_RADIUS, max - PLAYER_RADIUS);
  }

  private findClearSpawn(spawn: THREE.Vector3): THREE.Vector3 {
    return this.findNearestClearPoint(spawn) ?? spawn;
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
    const minX = collider.minX - PLAYER_RADIUS;
    const maxX = collider.maxX + PLAYER_RADIUS;
    const minZ = collider.minZ - PLAYER_RADIUS;
    const maxZ = collider.maxZ + PLAYER_RADIUS;
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
    return this.getInventory?.().includes(itemId) ?? false;
  }

  private syncLightingState(dt: number, t: number): void {
    const hasFlashlight = this.hasInventoryItem("flashlight");
    const libraryProfile = this.roomKind === "library";
    const targetAmbient = hasFlashlight ? (libraryProfile ? 0.5 : 0.85) : libraryProfile ? 0.1 : 0.22;
    const targetFill = hasFlashlight ? (libraryProfile ? 0.32 : 0.55) : libraryProfile ? 0.06 : 0.14;
    const targetNear = hasFlashlight ? (libraryProfile ? 0.5 : 0.85) : libraryProfile ? 0.08 : 0.24;
    const k = Math.min(1, dt * 6);

    this.ambientLight.intensity = THREE.MathUtils.lerp(this.ambientLight.intensity, targetAmbient, k);
    this.fillLight.intensity = THREE.MathUtils.lerp(this.fillLight.intensity, targetFill, k);
    this.nearFillLight.intensity = THREE.MathUtils.lerp(this.nearFillLight.intensity, targetNear, k);

    if (hasFlashlight) {
      this.flashlightSys.update(dt, t);
    } else {
      this.flashlight.intensity = 0;
    }

    this.updateBloodLight(t);
    this.updateAssetFlickerLights(t);
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
        const pickup = this.room.pickups.find((p) => p.itemId === entry.followPickupId);
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

    // 1. Feed the latest input snapshot into the context.
    const snap = this.inputManager.pollInput();
    ctx.input = snap;

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
    const currentStamina = this.getStamina?.() ?? 100;
    if (this.stateMachine.currentName === "run" && currentStamina > 0) {
      // Sprinting burns ~12 stamina per second → ~8 s full sprint.
      const newStamina = Math.max(0, currentStamina - 12 * dt);
      this.setStamina?.(newStamina);
      // Prevent sprinting when exhausted.
      if (newStamina <= 0) {
        ctx.input = { ...ctx.input, sprintHeld: false };
      }
    } else if (this.stateMachine.currentName === "walk" || this.stateMachine.currentName === "idle") {
      // Walking / idle recovers ~6 stamina per second.
      this.setStamina?.(Math.min(100, currentStamina + 6 * dt));
    }

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

    this.resolvePenetration();

    // 5. Resolve horizontal collision (per-axis wall sliding), preserved from the old code.
    if (ctx.velocity.x !== 0 || ctx.velocity.y !== 0) {
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

    this.resolvePenetration();

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

    if (this.baishaChase) {
      const multiplier = this.baishaChase.speedMultiplier();
      ctx.velocity.x *= multiplier;
      ctx.velocity.y *= multiplier;
    }

    // 7b. Story-state machine: only the current narrative phase is interactive.
    this.syncStoryPhase();

    // 8. Collect pickups.
    this.collectPickups();
    this.baishaChase?.update(dt, this.getStorySceneId?.() ?? "", this.room.pickups);
    // 9. Check story triggers.
    this.collectStoryTriggers();
    // 10. Door interaction (E key).
    this.handleDoorInteraction();
    // 10. Update guide line to active trigger.
    this.updateGuideLine();
  }

  /** Auto-collect any glowing item the player has walked onto. */
  private collectPickups(): void {
    const p = this.camera.position;
    for (const item of this.room.pickups) {
      if (item.taken || !item.glow.visible) continue;
      const dx = p.x - item.position.x;
      const dz = p.z - item.position.z;
      if (dx * dx + dz * dz <= item.radius * item.radius) {
        item.taken = true;
        item.glow.visible = false;
        this.setAssetPickupVisualVisible(item.itemId, false);
        this.baishaChase?.onPickup(item.itemId);
        this.onPickup?.(item.itemId, item.name);
      }
    }
  }

  /** Fire story popup when the player walks into a red trigger zone. */
  private collectStoryTriggers(): void {
    const p = this.camera.position;
    const triggers = this.room.storyTriggers;
    for (let i = 0; i < triggers.length; i++) {
      const trigger = triggers[i];
      if (trigger.triggered || !trigger.glow.visible) continue;
      const dx = p.x - trigger.position.x;
      const dz = p.z - trigger.position.z;
      if (dx * dx + dz * dz <= trigger.radius * trigger.radius) {
        trigger.triggered = true;
        trigger.glow.visible = false;
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
    const sceneId = this.getStorySceneId?.();

    for (const trigger of this.room.storyTriggers) {
      const isActive = !trigger.triggered && this.isTriggerAvailable(trigger, sceneId);
      trigger.glow.visible = isActive;
    }

    for (const item of this.room.pickups) {
      const phaseAllowsPickup = this.baishaChase ? this.baishaChase.isPickupEnabled(item.itemId) : true;
      const isActive = !item.taken && !this.hasInventoryItem(item.itemId) && phaseAllowsPickup && this.isPickupAvailable(item, sceneId);
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
      if (this.segmentHitsCollider(a, b, collider, PLAYER_RADIUS * 0.65)) return false;
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
    if (collider.gateId === "baisha-entry") return !useGameStore.getState().baishaRun.entryDoorOpen;
    if (collider.gateId === "baisha-shortcut") return !useGameStore.getState().baishaRun.shortcutGateOpen;
    if (!collider.activeSceneIds?.length) return true;
    const sceneId = this.getStorySceneId?.();
    return Boolean(sceneId && collider.activeSceneIds.includes(sceneId));
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.clock.elapsedTime;

    this.update(dt);
    this.room.update(t, this.camera.position);
    // Update door rotation animations.
    for (const door of this.room.doors) door.update(dt);

    this.syncLightingState(dt, t);

    this.renderer.render(this.scene, this.camera);
  };
}
