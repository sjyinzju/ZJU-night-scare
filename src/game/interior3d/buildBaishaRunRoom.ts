import * as THREE from "three";
import type { AABB, InteriorGuideNode, Pickup, RoomBuildResult } from "./buildRoom";

const PHOTO_SPOTS = [
  { x: -5.5, z: 6.0 },
  { x: -3.8, z: 7.0 },
  { x: -5.5, z: 8.0 },
  { x: -2.5, z: 5.5 },
];

/**
 * Gameplay-only geometry for the new dorm GLB (3D_Assets\宿舍\宿舍.blend).
 * The GLB root is offset by (-97, -24.7, -46) to centre the dorm.
 *
 * After offset:
 *   dorm centred near (-4.5, 0, ~4), door at z≈10
 *   corridor extends right to x≈26, forward to z≈25
 */
export function buildBaishaRunRoom(photoAnchor: number): RoomBuildResult {
  const root = new THREE.Group();
  root.name = "baisha-run-gameplay";
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  // ══════════════════════════════════════════════════════════════════
  // 程序化宿舍——GLB 加载期间即时显示，避免黑屏等待
  // GLB 加载完成后由 Interior3D.setProceduralRoomVisualsVisible(false) 隐藏。
  // ══════════════════════════════════════════════════════════════════
  const buildFallback = () => {
    const fallback = new THREE.Group();
    fallback.name = "baisha-fallback-dorm";
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x3b3a3f, roughness: 0.9 });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x2b333d, roughness: 0.96 });
    const ceilMat = new THREE.MeshStandardMaterial({ color: 0x17161a, roughness: 0.95 });
    materials.push(wallMat, floorMat, ceilMat);
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) => {
      const geo = new THREE.BoxGeometry(w, h, d);
      geometries.push(geo);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.userData.keepWithAsset = true; // GLB 加载后隐藏
      fallback.add(mesh);
    };
    // 地板、天花板
    box(6.5, 0.12, 9.5, -4.5, -0.06, 4.5, floorMat);
    box(6.5, 0.10, 9.5, -4.5, 3.15, 4.5, ceilMat);
    // 三面墙（左墙、右墙、前墙）。后墙不建——门禁 collider 阻挡，GLB 提供视觉
    box(0.24, 3.1, 9.5, -7.6, 1.55, 4.5, wallMat);   // 左
    box(0.24, 3.1, 9.5, -1.4, 1.55, 4.5, wallMat);   // 右
    box(6.8, 3.1, 0.24, -4.5, 1.55, -0.1, wallMat);   // 前
    root.add(fallback);
  };
  buildFallback();

  // ══════════════════════════════════════════════════════════════════
  // 碰撞体 — "回"形外环走廊 + 中横廊鬼捷径 + 宿舍
  //
  // 拓扑（俯视图，上=+Z，右=+X）：
  //                 顶部横廊 (z≈26.5-27.5)
  //        ┌──────────────────────────────────┐
  //        │  ┌──────────────────────────┐   │
  //  左竖廊│  │      中央区域             │   │右竖廊
  // (x≈    │  │  中横廊鬼捷径(z≈14-17)    │   │(x≈
  //  -10   │  │  ════════════════       │   │ 27)
  //  ~-7)  │  │                         │   │
  //        │  │  ┌──────┐               │   │
  //        │  │  │ 宿舍 │(x≈-7~-1,z≈0-9)│   │
  //        │  │  └──┬───┘               │   │
  //        │  └─────┼───────────────────┘   │
  //        └────────┼───────────────────────┘
  //            底部横廊 (z≈-3~0)
  //                 ↓左下出口
  //
  // 所有碰撞均来自实体墙/铁门/门锁。
  // ══════════════════════════════════════════════════════════════════

  const colliders: AABB[] = [
    // ── 宿舍墙（门在 GLB 后墙 z≈9.3-10.3 处）──
    // 宿舍左墙 (x≈-7.5)，连续完整无门洞
    { minX: -8.0, maxX: -7.3, minZ: 0,   maxZ: 9.5 },
    // 宿舍右墙 (x≈-1.5)
    { minX: -2.0, maxX: -1.3, minZ: 0,   maxZ: 9.5 },
    // 宿舍前墙 (z≈0)
    { minX: -8.0, maxX: -1.3, minZ: -1.0, maxZ: 0.5 },
    // 宿舍后墙门禁——GLB 门位于此，锁住时阻挡，打开后通过
    { minX: -5.5, maxX: -3.5, minZ: 9.3,  maxZ: 10.3, gateId: "baisha-entry" },

    // ── 外环走廊外墙（玩家绝对不可穿越）──
    // 左竖廊左外墙 (x≈-10, z:0→27)
    { minX: -10.3, maxX: -9.8,  minZ: 0,    maxZ: 27.3 },
    // 顶部横廊上外墙 (z≈27, x:-10→+28)
    { minX: -10.3, maxX: 28.2,  minZ: 26.8, maxZ: 27.3 },
    // 右竖廊右外墙 (x≈27.5, z:0→27)
    { minX: 27.2,  maxX: 27.7,  minZ: 0,    maxZ: 27.3 },
    // 底部横廊下外墙 (z≈-3, x:-10→+28)
    { minX: -10.3, maxX: 28.2,  minZ: -3.3, maxZ: -2.8 },

    // ── 内环走廊墙（分隔走廊与中央区域）──
    // 左竖廊内墙上段 (x≈-7.5, z:9.5→27) ——紧接宿舍后墙门洞右侧
    { minX: -8.0,  maxX: -7.3,  minZ: 10.5, maxZ: 27.3 },
    // 顶部横廊内下墙 (z≈24, x:-7.5→+25)
    { minX: -7.5,  maxX: 25.2,  minZ: 23.7, maxZ: 24.2 },
    // 右竖廊内左墙 (x≈24, z:10→24)
    { minX: 23.7,  maxX: 24.2,  minZ: 10.0, maxZ: 24.2 },

    // ── 中横廊鬼捷径（中心 z≈14-17 区域）──
    { minX: -7.5, maxX: 10.0, minZ: 14.0, maxZ: 15.0, gateId: "baisha-shortcut" },
    { minX: -7.5, maxX: 10.0, minZ: 16.0, maxZ: 17.0, gateId: "baisha-shortcut" },
    { minX: 7.0,  maxX: 10.0, minZ: 14.0, maxZ: 17.0, gateId: "baisha-shortcut" },

    // ── 左下出口 ——底部横廊左端，玩家绕完一圈到达
    { minX: -10.3, maxX: -5.0, minZ: -3.3, maxZ: -2.8 },
  ];

  const pickupMat = (color: number) => {
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 3.0, roughness: 0.3 });
    materials.push(mat);
    return mat;
  };
  const makePickup = (id: string, name: string, position: { x: number; z: number }, color: number): Pickup => {
    const group = new THREE.Group();
    group.name = `fallback_${id}`;
    group.position.set(position.x, 0.78, position.z);
    root.add(group);
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18, 1), pickupMat(color));
    geometries.push(core.geometry);
    group.add(core);
    const haloMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false });
    materials.push(haloMat);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 8), haloMat);
    geometries.push(halo.geometry);
    group.add(halo);
    const light = new THREE.PointLight(color, 5.0, 10.0, 2);
    group.add(light);
    return { id, itemId: id, name, glow: group, position: group.position.clone(), radius: 0.9, taken: false };
  };

  const photo = makePickup("photograph", "苏婉的老照片", PHOTO_SPOTS[photoAnchor % PHOTO_SPOTS.length], 0x88ccff);
  // 能量饮料：放在右竖廊上段，靠近右上拐角，追逐时可识别
  const energy = makePickup("energy", "能量饮料", { x: 25.5, z: 15 }, 0xff4f3c);
  energy.glow.visible = false;

  // ══════════════════════════════════════════════════════════════════
  // 导航图 — "回"形完整路径
  //
  // 路径: 宿舍 → 左竖廊↑ → 顶部横廊→ → 右竖廊↓ → 底部横廊← → 出口
  // 中横廊捷径在 CUT_OFF 阶段开放
  // ══════════════════════════════════════════════════════════════════
  const guideNodes: InteriorGuideNode[] = [
    // ── 宿舍段 ──
    { id: "dorm-center",  x: -4.5, z: 4.5,  links: ["dorm-door"] },
    // 门在 GLB 后墙 (z≈9.5)
    { id: "dorm-door",    x: -4.5, z: 9.5,  links: ["dorm-center", "left-mid"] },

    // ── 左竖廊（向上跑）──
    { id: "left-mid",     x: -8.7, z: 12.0, links: ["dorm-door", "left-north", "shortcut-west"] },
    { id: "left-north",   x: -8.7, z: 20.0, links: ["left-mid", "top-west"] },

    // ── 顶部横廊（向右跑）──
    { id: "top-west",     x: -5.0, z: 26.5, links: ["left-north", "top-mid"] },
    { id: "top-mid",      x: 10.0, z: 26.5, links: ["top-west", "top-east"] },
    { id: "top-east",     x: 25.0, z: 26.5, links: ["top-mid", "right-north"] },

    // ── 右竖廊（向下跑）──
    { id: "right-north",  x: 25.8, z: 22.0, links: ["top-east", "right-mid"] },
    { id: "right-mid",    x: 25.8, z: 15.0, links: ["right-north", "right-south", "shortcut-east"] },
    { id: "right-south",  x: 25.8, z: 7.0,  links: ["right-mid", "bottom-east"] },

    // ── 底部横廊（向左跑回出口）──
    { id: "bottom-east",  x: 18.0, z: 1.0,  links: ["right-south", "bottom-mid"] },
    { id: "bottom-mid",   x: 5.0,  z: 1.0,  links: ["bottom-east", "bottom-west"] },
    { id: "bottom-west",  x: -5.0, z: 1.0,  links: ["bottom-mid", "exit"] },

    // ── 出口 ──
    { id: "exit",         x: -8.5, z: -1.0, links: ["bottom-west"] },

    // ── 中横廊鬼捷径（CUT_OFF 阶段铁门打开后可用）──
    { id: "shortcut-west", x: -7.2, z: 15.5, links: ["left-mid", "shortcut-mid"] },
    { id: "shortcut-mid",  x: 2.0,  z: 15.5, links: ["shortcut-west", "shortcut-east"] },
    { id: "shortcut-east", x: 7.2,  z: 15.5, links: ["shortcut-mid", "right-mid"] },
  ];

  // 关闭 isWalkable 软约束——所有路线限制来自实体墙碰撞。
  const isWalkable = undefined;

  const update = (time: number): void => {
    for (const pickup of [photo, energy]) {
      if (pickup.taken || !pickup.glow.visible) continue;
      pickup.glow.rotation.y = time * 1.25;
      pickup.glow.position.y = pickup.position.y + Math.sin(time * 2.1 + pickup.position.x) * 0.07;
    }
  };

  return {
    root,
    colliders,
    // bounds 收紧到 corridor 外壁之内，与 GLB 实际几何匹配
    bounds: { minX: -10.3, maxX: 27.7, minZ: -3.3, maxZ: 27.3 },
    update,
    floorHeightAt: () => 0,
    pickups: [photo, energy],
    storyTriggers: [],
    doors: [],
    guideNodes,
    phaseObjects: [],
    npcGroups: [],
    spawn: new THREE.Vector3(-4.5, 1.6, 4.0),
    isWalkable,
    dispose: () => {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      root.clear();
    },
  };
}
