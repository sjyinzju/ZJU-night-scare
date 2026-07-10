import * as THREE from "three";
import { buildRoom, classifyRoom, type AABB, type InteriorGuideNode, type RoomBuildResult } from "./buildRoom";
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
  private colliders: AABB[];
  private bounds: AABB;
  private readonly blueprint: InteriorBlueprint;
  private readonly onPickup?: (itemId: string, name: string) => void;
  private readonly onStoryTrigger?: (sceneId: string) => void;
  private readonly onExitTrigger?: () => void;
  private readonly getStorySceneId?: () => string;
  private readonly getInventory?: () => string[];
  private readonly getStamina?: () => number;
  private readonly setStamina?: (value: number) => void;
  private lowStaminaWarning = false;
  private bloodLightEnabled = false;
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
    this.getStorySceneId = options.getStorySceneId;
    this.getInventory = options.getInventory;
    this.getStamina = options.getStamina;
    this.setStamina = options.setStamina;

    // ---- Renderer ----
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isMobile,
      powerPreference: "high-performance",
    });
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
    const roomKind = classifyRoom(options.buildingId, options.zone);
    this.bloodLightEnabled = roomKind === "library";
    this.blueprint = getInteriorBlueprint(roomKind);
    this.room = buildRoom(roomKind);
    this.scene.add(this.room.root);
    this.colliders = this.room.colliders;
    this.bounds = this.room.bounds;

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

  private collides(x: number, z: number): boolean {
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
    const targetAmbient = hasFlashlight ? 0.85 : 0.22;
    const targetFill = hasFlashlight ? 0.55 : 0.14;
    const targetNear = hasFlashlight ? 0.85 : 0.24;
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
      this.bloodLight.intensity = 4.8 * Math.max(0.35, phase) * pulse;
    } else {
      this.bloodLight.intensity = 0;
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

    // 7b. Story-state machine: only the current narrative phase is interactive.
    this.syncStoryPhase();

    // 8. Collect pickups.
    this.collectPickups();
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
      const isActive = !item.taken && !this.hasInventoryItem(item.itemId) && this.isPickupAvailable(item, sceneId);
      item.glow.visible = isActive;
    }

    for (const phaseObject of this.room.phaseObjects) {
      phaseObject.object.visible = this.isPhaseObjectAvailable(phaseObject, sceneId);
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
