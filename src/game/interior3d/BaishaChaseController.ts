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
// 右竖廊岔路截击点——鬼从中横廊穿出后到达的位置
const RIGHT_JUNCTION = new THREE.Vector3(25, 0, 15);
// 左下出口位置——玩家绕完一圈后到达
const EXIT_POINT = new THREE.Vector3(-8.5, 0, -1);
const _tempVec = new THREE.Vector3();

/**
 * Runs the Baisha dorm escape without making React re-render every animation
 * frame.  Store writes are limited to irreversible gameplay events.
 */
export class BaishaChaseController {
  private readonly ghostFallback = new THREE.Group();
  // 鬼自发光：血红色，与走廊暗红灯色一致
  private readonly ghostGlow = new THREE.PointLight(0xcc1111, 0, 12, 1.5);
  private ghost: THREE.Object3D;
  private visualRoot?: THREE.Object3D;
  private openingStartedAt = 0;
  private missedEnergyAt = 0;
  private corridorLights: THREE.PointLight[] = [];
  private dormLights: THREE.PointLight[] = [];
  private readonly ghostPath = [
    // 鬼在左竖廊后门下方 (x≈-8.7, z≈7) → 上移 → 中横廊横穿 → 右竖廊截击
    new THREE.Vector3(-8.7, 0, 7.0),
    new THREE.Vector3(-7.2, 0, 15.5),
    new THREE.Vector3(7.2,  0, 15.5),
    RIGHT_JUNCTION,
  ];
  private ghostPathIndex = 0;
  private disposed = false;
  private _dbgWaitLog = 0; // 追踪等待状态

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly callbacks: Callback,
  ) {
    this.ghostFallback.name = "GHOST_SLENDER_FALLBACK";
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1a0000, roughness: 0.6, metalness: 0.15, emissive: 0x330000, emissiveIntensity: 0.5 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0x8b1a1a, roughness: 0.7, emissive: 0x220000, emissiveIntensity: 0.3 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 1.9, 5, 10), bodyMat);
    body.position.y = 1.35;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 10), skinMat);
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
      const glow = new THREE.PointLight(0xcc1111, 8.5, 12, 1.6);
      glow.name = "GHOST_RED_GLOW";
      glow.position.y = 1.6;
      this.ghost.add(glow);
    }
  }

  onPickup(itemId: string): void {
    const { baishaRun, patchBaishaRun } = useGameStore.getState();
    if (itemId === "photograph" && baishaRun.phase === "searching") {
      patchBaishaRun({ photoCollected: true, phase: "photo-reveal" });
      // 将回调推迟到下一个 microtask，避免在 rAF 回调内触发 React setState
      // 导致 DOM 更新与 3D 渲染争抢帧预算
      queueMicrotask(() => this.callbacks.onPhotoReveal());
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
      console.log(`[BAISHA-DEBUG] 门开始打开 currentSceneId="${currentSceneId}" phase=photo-reveal`);
    }
    if (run.phase === "photo-reveal" && currentSceneId !== "dorm_escape") {
      // 每2秒输出一次，确认是否卡在等待 dorm_escape
      if (!this._dbgWaitLog || performance.now() - this._dbgWaitLog > 2000) {
        this._dbgWaitLog = performance.now();
        console.log(`[BAISHA-DEBUG] 等待剧情推进... currentSceneId="${currentSceneId}" phase=${run.phase}`);
      }
    }

    const latest = useGameStore.getState().baishaRun;
    this.animateDoors(latest);
    this.updateRedLights(latest);
    this.setPickupVisibility(pickups, latest);

    if (latest.phase === "door-opening" && performance.now() - this.openingStartedAt > 850) {
      useGameStore.getState().patchBaishaRun({ entryDoorOpen: true, phase: "look-left-trap" });
      this.ghost.visible = true;
      console.log("[BAISHA-DEBUG] 门已打开！entryDoorOpen=true, 玩家可通过门禁");
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

  /** 获取鬼在世界空间的位置（供小地图等使用） */
  getGhostWorldPosition(target: THREE.Vector3): THREE.Vector3 {
    return this.ghost.getWorldPosition(target);
  }

  /** 鬼当前是否可见 */
  isGhostVisible(): boolean {
    return this.ghost.visible;
  }

  /** GLB 加载后由 Interior3D 注入灯光引用数组，替代每帧 root.traverse() */
  setLights(corridorLights: THREE.PointLight[], dormLights: THREE.PointLight[]): void {
    this.corridorLights = corridorLights;
    this.dormLights = dormLights;
  }

  private tryTriggerFirstSight(): void {
    const player = this.camera.position;
    // 玩家从后墙门 (z≈9.5) 走出，鬼在左竖廊下方 (x≈-8.7, z≈7)。
    if (player.z < 9.2 || player.z > 12 || player.x > -5.5) return;
    const toGhost = this.ghost.getWorldPosition(_tempVec).clone().sub(player).setY(0);
    const distance = toGhost.length();
    if (distance > 14 || distance < 0.1) return;
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
    // 玩家是否已过右上拐角进入右竖廊（x>20 且 z>20，即已转过顶部横廊）
    const playerPassedJunction = player.x >= 20 && player.z > 20;
    // 鬼是否已到达右竖廊岔路截击点
    const ghostAtJunction = this.ghostPathIndex >= this.ghostPath.length - 1
      && this.ghost.getWorldPosition(_tempVec).distanceToSquared(RIGHT_JUNCTION) < 0.5;

    if (state.phase === "chasing") {
      if (playerPassedJunction && !ghostAtJunction) {
        // 分支 B: 玩家先到 → 尾追
        useGameStore.getState().patchBaishaRun({ phase: "tail-chase" });
      } else if (ghostAtJunction && !playerPassedJunction) {
        // 分支 A: 鬼先到 → 截击 + 铁门打开
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
    else if (latest.phase === "cut-off") {
      // 截击分支：鬼从右竖廊往玩家方向反追
      this.moveTowards(dt, new THREE.Vector3(player.x, 0, player.z));
    } else {
      // 尾追分支：鬼沿玩家路径追赶
      this.moveTowards(dt, new THREE.Vector3(player.x, 0, player.z));
    }

    // 能量饮料错过检测：玩家经过右竖廊上段（饮料位置附近）
    const energyDist = Math.hypot(player.x - 25.5, player.z - 15);
    if (!latest.energyCollected && !latest.energyMissed && player.x > 20 && energyDist > 3.0 && player.z < 18) {
      this.missedEnergyAt = performance.now();
      useGameStore.getState().patchBaishaRun({ energyMissed: true });
    }

    // 出口检测：左下角 (x<-7, z<0)，完成一圈后到达
    const exitReached = player.x < -7 && player.z < 0;
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
    const player = this.camera.position;
    const t = performance.now() / 1000;

    // ── 宿舍吊灯 ──
    for (const light of this.dormLights) {
      const dist = Math.hypot(light.position.x - player.x, light.position.z - player.z);
      if (state.phase === "searching") {
        if (dist > 10) { light.intensity = 0; continue; }
        const flicker = 0.55 + 0.45 * Math.sin(t * 2.7 + light.position.x * 3.1);
        light.intensity = 100 * Math.max(0.25, flicker);
      } else {
        if (dist > 14) { light.intensity = 0; continue; }
        const flicker = 0.5 + 0.5 * Math.sin(t * 5.5 + light.position.x * 4.3);
        light.intensity = 140 * Math.max(0.15, flicker);
      }
    }

    // ── 走廊灯：8 盏动态布置在玩家前方 ──
    if (state.phase === "searching") {
      // 探索阶段：走廊灯全灭，GLB 灯管 emissive 提供微弱氛围
      for (const light of this.corridorLights) light.intensity = 0;
      return;
    }

    // 追逐阶段：8 盏灯分布在玩家前后 8m 范围内
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    // 玩家朝向可能指向走廊走向；同时考虑玩家位置到各路段的最短距离
    const px = player.x;
    const pz = player.z;
    // 把 8 盏灯均匀分布在玩家前后 ±6m 区间
    for (let i = 0; i < this.corridorLights.length; i++) {
      const light = this.corridorLights[i];
      const frac = (i - 3) / 4; // -0.75 到 1.0，前方多后方少
      const tx = px + forward.x * frac * 8;
      const tz = pz + forward.z * frac * 8;
      light.position.set(tx, 3.1, tz);
      const dist = Math.abs(frac * 8);
      if (dist > 10) { light.intensity = 0; continue; }
      // 渐亮/渐灭：距离越远越暗
      const falloff = 1 - Math.min(1, dist / 10);
      const flicker = 0.6 + 0.4 * Math.sin(t * 4.8 + i * 1.7);
      light.intensity = 80 * falloff * Math.max(0.2, flicker);
    }
  }
}
