import * as THREE from "three";
import { buildRoom, classifyRoom, type AABB, type RoomBuildResult } from "./buildRoom";
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
  /** Current stamina 0-100 (read from story state). */
  getStamina?: () => number;
  /** Persist stamina back to story state. */
  setStamina?: (value: number) => void;
  /** Current player inventory for door key checks. */
  getDoorInventory?: () => string[];
}

const PLAYER_RADIUS = 0.32;
const EYE_HEIGHT = 1.6;

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

  private room: RoomBuildResult;
  private colliders: AABB[];
  private bounds: AABB;
  private readonly blueprint: InteriorBlueprint;
  private readonly onPickup?: (itemId: string, name: string) => void;
  private readonly onStoryTrigger?: (sceneId: string) => void;
  private readonly getStamina?: () => number;
  private readonly setStamina?: (value: number) => void;
  private lowStaminaWarning = false;

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
    const ambient = new THREE.AmbientLight(0x2a3038, 0.85);
    this.scene.add(ambient);
    const fill = new THREE.HemisphereLight(0x28303c, 0x0a0c10, 0.55);
    this.scene.add(fill);

    // 近距离补光:跟随相机的一盏很弱、短射程点光,只照亮角色周围、脚下和近处墙壁。
    const nearFill = new THREE.PointLight(0xaeb6c6, 0.85, 5.0, 2.0);
    nearFill.position.set(0, -0.2, 0.1);
    this.camera.add(nearFill);

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
    this.blueprint = getInteriorBlueprint(roomKind);
    this.room = buildRoom(roomKind);
    this.scene.add(this.room.root);
    this.colliders = this.room.colliders;
    this.bounds = this.room.bounds;

    // Spawn at the room's entrance, looking down the corridor (-Z).
    this.camera.position.copy(this.room.spawn);

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

    this.resize();
  }

  /** Begin listeners + render loop. */
  start(): void {
    window.addEventListener("resize", this.onResize);
    if (!this.isMobile) {
      window.addEventListener("keydown", this.onKeyDown);
      window.addEventListener("keyup", this.onKeyUp);
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
      if (item.taken) continue;
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
      if (trigger.triggered) continue;
      const dx = p.x - trigger.position.x;
      const dz = p.z - trigger.position.z;
      if (dx * dx + dz * dz <= trigger.radius * trigger.radius) {
        trigger.triggered = true;
        trigger.glow.visible = false;
        // Show the next trigger (if any)
        if (i + 1 < triggers.length) {
          triggers[i + 1].glow.visible = true;
        }
        this.onStoryTrigger?.(trigger.sceneId);
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
    // Pre-allocate 2-point geometry; updated in-place every frame.
    const geo = new THREE.BufferGeometry();
    const arr = new Float32Array([0, 0.08, 0, 0, 0.08, 0]);
    geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    this.guideLine = new THREE.Line(geo, mat);
    this.guideLine.visible = false;
    this.scene.add(this.guideLine);
  }

  /** Point the dashed line from camera to the first non-triggered story trigger. */
  private updateGuideLine(): void {
    if (!this.guideLine) return;
    const active = this.room.storyTriggers.find((t) => !t.triggered);
    if (!active) {
      this.guideLine.visible = false;
      return;
    }
    const cam = this.camera.position;
    const pos = this.guideLine.geometry.attributes.position;
    pos.setXYZ(0, cam.x, 0.08, cam.z);
    pos.setXYZ(1, active.position.x, 0.08, active.position.z);
    pos.needsUpdate = true;
    this.guideLine.computeLineDistances();
    this.guideLine.visible = true;
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

    // Flashlight battery decay + flicker (replaces old static flicker).
    this.flashlightSys.update(dt, t);

    this.renderer.render(this.scene, this.camera);
  };
}
