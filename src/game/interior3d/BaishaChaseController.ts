import * as THREE from "three";
import { JumpscarePipeline } from "../JumpscarePipeline";
import { useGameStore } from "../store";
import type { Pickup } from "./buildRoom";

type Callback = {
  onPhotoReveal: () => void;
  onLevelExit: () => void;
  onDeath: () => void;
};

const GHOST_SPEED = 2.78;
const CATCH_DISTANCE = 0.78;
const RIGHT_JUNCTION = new THREE.Vector3(10, 0, 22);
const _tempVec = new THREE.Vector3();

/**
 * Runs the Baisha dorm escape without making React re-render every animation
 * frame.  Store writes are limited to irreversible gameplay events.
 */
export class BaishaChaseController {
  private readonly ghostFallback = new THREE.Group();
  private readonly ghostGlow = new THREE.PointLight(0xff1010, 0, 9, 1.35);
  private ghost: THREE.Object3D;
  private visualRoot?: THREE.Object3D;
  private openingStartedAt = 0;
  private missedEnergyAt = 0;
  private readonly ghostPath = [
    new THREE.Vector3(-8, 0, 11.5),   // 鬼出生点：宿舍门外左侧
    new THREE.Vector3(-5, 0, 14),      // 走廊中段
    RIGHT_JUNCTION,                     // 走廊右段能量饮料处 (10, 0, 22)
  ];
  private ghostPathIndex = 0;
  private disposed = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly callbacks: Callback,
  ) {
    this.ghostFallback.name = "GHOST_SLENDER_FALLBACK";
    const black = new THREE.MeshStandardMaterial({ color: 0x060407, roughness: 0.74, metalness: 0.08 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x9b8885, roughness: 0.9 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 1.9, 5, 10), black);
    body.position.y = 1.35;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 10), skin);
    head.position.y = 2.62;
    this.ghostFallback.add(body, head, this.ghostGlow);
    this.ghostFallback.position.copy(this.ghostPath[0]);
    this.ghostFallback.visible = false;
    this.scene.add(this.ghostFallback);
    this.ghost = this.ghostFallback;
  }

  bindAsset(root: THREE.Object3D): void {
    this.visualRoot = root;
    const authoredGhost = root.getObjectByName("GHOST_SLENDER");
    if (!authoredGhost) return;
    this.ghostFallback.visible = false;
    this.ghost = authoredGhost;
    // 将鬼放到 world-space 路径起点（根节点有 offset，需转换到 local）
    if (this.ghost.parent) {
      const local = this.ghost.parent.worldToLocal(this.ghostPath[0].clone());
      this.ghost.position.copy(local);
    } else {
      this.ghost.position.copy(this.ghostPath[0]);
    }
    this.ghost.visible = false;
    if (!this.ghost.getObjectByName("GHOST_RED_GLOW")) {
      const glow = new THREE.PointLight(0xff0808, 6.5, 9, 1.4);
      glow.name = "GHOST_RED_GLOW";
      glow.position.y = 1.6;
      this.ghost.add(glow);
    }
  }

  onPickup(itemId: string): void {
    const { baishaRun, patchBaishaRun } = useGameStore.getState();
    if (itemId === "photograph" && baishaRun.phase === "searching") {
      patchBaishaRun({ photoCollected: true, phase: "photo-reveal" });
      this.callbacks.onPhotoReveal();
      return;
    }
    if (itemId === "energy" && ["chasing", "cut-off", "tail-chase"].includes(baishaRun.phase)) {
      patchBaishaRun({ energyCollected: true });
    }
  }

  isPickupEnabled(itemId: string): boolean {
    const state = useGameStore.getState().baishaRun;
    if (itemId === "photograph") return state.phase === "searching";
    if (itemId === "energy") return ["chasing", "cut-off", "tail-chase"].includes(state.phase);
    return true;
  }

  speedMultiplier(): number {
    const state = useGameStore.getState().baishaRun;
    if (!state.energyMissed) return state.energyCollected ? 1 : 0.9;
    const elapsed = Math.max(0, performance.now() - this.missedEnergyAt) / 1000;
    return Math.max(0.78, 0.9 - elapsed * 0.012);
  }

  update(dt: number, currentSceneId: string, pickups: Pickup[]): void {
    if (this.disposed) return;
    const store = useGameStore.getState();
    const run = store.baishaRun;

    // 搜索阶段强制隐藏鬼（fallback 和 authored）
    if (run.phase === "searching" || run.phase === "photo-reveal") {
      this.ghostFallback.visible = false;
      if (this.ghost !== this.ghostFallback) this.ghost.visible = false;
    }

    if (currentSceneId === "dorm_escape" && run.phase === "photo-reveal") {
      this.openingStartedAt = performance.now();
      store.patchBaishaRun({ phase: "door-opening" });
    }

    const latest = useGameStore.getState().baishaRun;
    this.animateDoors(latest);
    this.updateRedLights(latest);
    this.setPickupVisibility(pickups, latest);

    if (latest.phase === "door-opening" && performance.now() - this.openingStartedAt > 850) {
      useGameStore.getState().patchBaishaRun({ entryDoorOpen: true, phase: "look-left-trap" });
      this.ghost.visible = true;
      return;
    }
    if (!["look-left-trap", "chasing", "cut-off", "tail-chase"].includes(latest.phase)) return;

    if (latest.phase === "look-left-trap") {
      this.tryTriggerFirstSight();
      return;
    }

    this.updateChase(dt, latest);
  }

  dispose(): void {
    this.disposed = true;
    this.scene.remove(this.ghostFallback);
    this.ghostFallback.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose?.();
    });
  }

  private tryTriggerFirstSight(): void {
    const player = this.camera.position;
    // The initial left-side pool of light is only visible after crossing the
    // dorm threshold.  Looking at the red silhouette, rather than a mouse
    // delta, is the actual trigger.
    if (player.z < 9.5 || player.z > 12 || player.x > -3.5) return;
    const toGhost = this.ghost.position.clone().sub(player).setY(0);
    const distance = toGhost.length();
    if (distance > 12 || distance < 0.1) return;
    toGhost.multiplyScalar(1 / distance);
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    if (forward.dot(toGhost) < Math.cos(Math.PI / 4)) return;

    useGameStore.getState().patchBaishaRun({ firstScareTriggered: true, phase: "chasing" });
    JumpscarePipeline.executeStoryEffect("dorm", 0.72, "它一直站在门外。 ");
  }

  private updateChase(dt: number, state: ReturnType<typeof useGameStore.getState>["baishaRun"]): void {
    const player = this.camera.position;
    const playerPassedJunction = player.x >= 8 && player.z > 18;
    const ghostAtJunction = this.ghostPathIndex >= this.ghostPath.length - 1
      && this.ghost.getWorldPosition(_tempVec).distanceToSquared(RIGHT_JUNCTION) < 0.35;

    if (state.phase === "chasing") {
      if (playerPassedJunction && !ghostAtJunction) {
        useGameStore.getState().patchBaishaRun({ phase: "tail-chase" });
      } else if (ghostAtJunction && !playerPassedJunction) {
        useGameStore.getState().patchBaishaRun({
          phase: "cut-off",
          secondScareTriggered: true,
          shortcutGateOpen: true,
        });
        JumpscarePipeline.executeStoryEffect("dorm", 0.88, "它已经在前面等着了。 ");
      }
    }

    const latest = useGameStore.getState().baishaRun;
    if (latest.phase === "chasing") this.moveAlongShortcut(dt);
    else if (latest.phase === "cut-off") this.moveTowards(dt, new THREE.Vector3(8, 0, 20));
    else this.moveTowards(dt, new THREE.Vector3(player.x, 0, player.z));

    const energy = Math.hypot(player.x - 10, player.z - 22);
    if (!latest.energyCollected && !latest.energyMissed && player.z > 16 && energy > 2.4) {
      this.missedEnergyAt = performance.now();
      useGameStore.getState().patchBaishaRun({ energyMissed: true });
    }

    const exitReached = player.x > 20 && player.z > 22;
    if (exitReached) {
      useGameStore.getState().patchBaishaRun({ exitReached: true, phase: "exiting" });
      this.callbacks.onLevelExit();
      return;
    }

    if (this.ghost.getWorldPosition(_tempVec).distanceToSquared(player) < CATCH_DISTANCE * CATCH_DISTANCE) {
      useGameStore.getState().patchBaishaRun({ phase: "dead" });
      this.callbacks.onDeath();
    }
  }

  private moveAlongShortcut(dt: number): void {
    const target = this.ghostPath[this.ghostPathIndex];
    if (this.moveTowards(dt, target) && this.ghostPathIndex < this.ghostPath.length - 1) this.ghostPathIndex += 1;
  }

  private moveTowards(dt: number, target: THREE.Vector3): boolean {
    const worldPos = this.ghost.getWorldPosition(_tempVec);
    const direction = target.clone().sub(worldPos);
    direction.y = 0;
    const distance = direction.length();
    if (distance < 0.04) return true;
    direction.multiplyScalar(1 / distance);
    // 将世界空间位移加到 local position
    this.ghost.position.add(direction.clone().multiplyScalar(Math.min(distance, GHOST_SPEED * dt)));
    const targetYaw = Math.atan2(direction.x, direction.z);
    this.ghost.rotation.y = THREE.MathUtils.damp(this.ghost.rotation.y, targetYaw, 8, dt);
    return distance < 0.16;
  }

  private setPickupVisibility(pickups: Pickup[], state: ReturnType<typeof useGameStore.getState>["baishaRun"]): void {
    for (const pickup of pickups) {
      if (pickup.taken) continue;
      if (pickup.itemId === "photograph") pickup.glow.visible = state.phase === "searching";
      if (pickup.itemId === "energy") pickup.glow.visible = this.isPickupEnabled("energy");
    }
  }

  private animateDoors(state: ReturnType<typeof useGameStore.getState>["baishaRun"]): void {
    const root = this.visualRoot;
    if (!root) return;
    const entry = root.getObjectByName("DOOR_DORM_EXIT");
    if (entry) entry.rotation.y = state.entryDoorOpen ? -Math.PI / 2 : 0;
    const gate = root.getObjectByName("GATE_SHORTCUT");
    if (gate) gate.rotation.y = state.shortcutGateOpen ? Math.PI / 2 : 0;
  }

  private updateRedLights(state: ReturnType<typeof useGameStore.getState>["baishaRun"]): void {
    const root = this.visualRoot;
    if (!root) return;
    const player = this.camera.position;
    root.traverse((obj) => {
      if (!obj.name.startsWith("RUN_LIGHT_")) return;
      const light = obj as THREE.Light;
      if (!light.isLight) return;
      const distance = Math.hypot(light.position.x - player.x, light.position.z - player.z);
      if (state.phase === "searching") {
        // 探索阶段：低亮度红色氛围光，帮助玩家看清宿舍
        light.intensity = distance < 8 ? 1.2 : 0;
      } else {
        // 追逐阶段：高亮度红色闪烁灯
        light.intensity = distance < 10 ? 3.2 : 0;
      }
    });
  }
}
