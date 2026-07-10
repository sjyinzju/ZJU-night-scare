import * as THREE from "three";
import { buildRoom, classifyRoom, type AABB, type RoomBuildResult } from "./buildRoom";

export interface Interior3DOptions {
  /** Element the WebGL canvas is appended into. Sized to fill it. */
  container: HTMLElement;
  buildingId: string;
  zone?: string;
  /** Mobile skips pointer-lock / mouse look; input arrives via methods. */
  isMobile?: boolean;
}

const PLAYER_RADIUS = 0.32;
const EYE_HEIGHT = 1.6;
const MOVE_SPEED = 3.0; // metres / second
const LOOK_SENSITIVITY = 0.0022;
const TOUCH_LOOK_SENSITIVITY = 0.005;

/**
 * Self-contained first-person interior renderer. Owns its renderer, scene,
 * camera, animation loop and (on desktop) input listeners. Mobile input is
 * pushed in through `setMoveInput` / `addLook`.
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

  private room: RoomBuildResult;
  private colliders: AABB[];
  private bounds: AABB;

  // View angles (radians). yaw around Y, pitch around X.
  private yaw = 0;
  private pitch = 0;

  // Movement intent, -1..1. moveZ: forward+, moveX: strafe right+.
  private moveZ = 0;
  private moveX = 0;
  private readonly keys = new Set<string>();

  private rafId = 0;
  private disposed = false;
  private pointerLocked = false;

  // Bound handlers (kept so they can be removed on dispose).
  private readonly onResize = () => this.resize();
  private readonly onKeyDown = (e: KeyboardEvent) => this.handleKey(e, true);
  private readonly onKeyUp = (e: KeyboardEvent) => this.handleKey(e, false);
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
    this.scene.background = new THREE.Color(0x05060a);
    this.scene.fog = new THREE.Fog(0x05060a, 3, 16);

    // ---- Camera ----
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.05, 100);
    this.camera.position.set(0, EYE_HEIGHT, 0);
    this.scene.add(this.camera);

    // ---- Lights ----
    const ambient = new THREE.AmbientLight(0x20242c, 0.5);
    this.scene.add(ambient);
    const fill = new THREE.HemisphereLight(0x1a1f2a, 0x050505, 0.35);
    this.scene.add(fill);

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

    // ---- Room ----
    this.room = buildRoom(classifyRoom(options.buildingId, options.zone));
    this.scene.add(this.room.root);
    this.colliders = this.room.colliders;
    this.bounds = this.room.bounds;

    // Spawn at the room's entrance, looking down the corridor (-Z).
    this.camera.position.copy(this.room.spawn);
    this.yaw = Math.PI; // face -Z
    this.applyRotation();

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
    this.moveX = THREE.MathUtils.clamp(x, -1, 1);
    this.moveZ = THREE.MathUtils.clamp(y, -1, 1);
  }

  /** Apply a look delta (pixels). Used by touch drag. */
  addLook(dx: number, dy: number): void {
    this.yaw -= dx * TOUCH_LOOK_SENSITIVITY;
    this.pitch -= dy * TOUCH_LOOK_SENSITIVITY;
    this.clampPitch();
    this.applyRotation();
  }

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
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    this.renderer.domElement.removeEventListener("click", this.onCanvasClick);
    this.exitPointerLock();

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

  private handleKey(e: KeyboardEvent, down: boolean): void {
    const code = e.code;
    const tracked =
      code === "KeyW" ||
      code === "KeyA" ||
      code === "KeyS" ||
      code === "KeyD" ||
      code === "ArrowUp" ||
      code === "ArrowDown" ||
      code === "ArrowLeft" ||
      code === "ArrowRight";
    if (!tracked) return;
    e.preventDefault();
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.pointerLocked) return;
    this.yaw -= e.movementX * LOOK_SENSITIVITY;
    this.pitch -= e.movementY * LOOK_SENSITIVITY;
    this.clampPitch();
    this.applyRotation();
  }

  private clampPitch(): void {
    const limit = Math.PI / 2 - 0.05;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -limit, limit);
  }

  private applyRotation(): void {
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);
  }

  private keyboardMoveVector(): { x: number; z: number } {
    let x = 0;
    let z = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) z += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) z -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) x += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) x -= 1;
    return { x, z };
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

  private update(dt: number): void {
    // Combine keyboard + injected (touch joystick) intent.
    const kb = this.keyboardMoveVector();
    let inX = kb.x + this.moveX;
    let inZ = kb.z + this.moveZ;
    const len = Math.hypot(inX, inZ);
    if (len > 1) {
      inX /= len;
      inZ /= len;
    }

    if (inX !== 0 || inZ !== 0) {
      // Forward is where yaw points, projected onto the floor.
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      // camera forward (yaw=0 => -Z). derive movement in world space.
      const forwardX = -sin;
      const forwardZ = -cos;
      const rightX = cos;
      const rightZ = -sin;

      const dx = (forwardX * inZ + rightX * inX) * MOVE_SPEED * dt;
      const dz = (forwardZ * inZ + rightZ * inX) * MOVE_SPEED * dt;

      const pos = this.camera.position;
      // Per-axis resolution so we slide along walls instead of sticking.
      let nx = this.clampToBounds(pos.x + dx, this.bounds.minX, this.bounds.maxX);
      if (this.collides(nx, pos.z)) nx = pos.x;
      let nz = this.clampToBounds(pos.z + dz, this.bounds.minZ, this.bounds.maxZ);
      if (this.collides(nx, nz)) nz = pos.z;

      pos.x = nx;
      pos.z = nz;
      pos.y = EYE_HEIGHT;
    }
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.clock.elapsedTime;

    this.update(dt);
    this.room.npcUpdate(t);

    // Subtle flashlight flicker for horror.
    this.flashlight.intensity = 6.0 + Math.sin(t * 22) * 0.4 + Math.sin(t * 7) * 0.2;

    this.renderer.render(this.scene, this.camera);
  };
}
