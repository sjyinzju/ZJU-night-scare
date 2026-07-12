import * as THREE from "three";
import type { AABB, InteriorGuideNode, Pickup, RoomBuildResult } from "./buildRoom";

const PHOTO_SPOTS = [
  { x: -4.5, z: 4.5 },
  { x: -3.8, z: 4.1 },
  { x: -3.0, z: 5.5 },
  { x: -4.1, z: 3.2 },
];

/**
 * Gameplay-only geometry for the authored Baisha GLB.  The rendered scene is
 * supplied by Blender; this small fallback owns collision, pickup and route
 * truth so the level remains playable if a visual LOD cannot be fetched.
 *
 * Coordinate system: after GLB root offset of (-97, -24.7, -46),
 * the dorm room is centered around x≈-4.5, z≈4.
 * The corridor extends from the dorm door (z≈10) forward to z≈25 and right to x≈26.
 */
export function buildBaishaRunRoom(photoAnchor: number): RoomBuildResult {
  const root = new THREE.Group();
  root.name = "baisha-run-gameplay";
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const colliders: AABB[] = [
    // Dorm entry door gate — blocks exit until photo is acknowledged
    { minX: -5.5, maxX: -3.5, minZ: 9.3, maxZ: 10.3, gateId: "baisha-entry" },
    // Shortcut gate in corridor — blocks player until cut-off sequence
    { minX: -9, maxX: 2, minZ: 15.5, maxZ: 17, gateId: "baisha-shortcut" },

    // ── 走廊外墙碰撞体（防止穿墙走到场景外）──
    // 走廊左侧外墙
    { minX: -9.5, maxX: -8.8, minZ: 10, maxZ: 26 },
    // 走廊顶侧外墙
    { minX: -9, maxX: 27, minZ: 25.5, maxZ: 26.5 },
    // 走廊右侧外墙
    { minX: 26.5, maxX: 27.5, minZ: 10, maxZ: 26 },

    // ── 宿舍外墙碰撞体（防止穿墙）──
    // 宿舍左侧墙
    { minX: -7, maxX: -6.3, minZ: 2, maxZ: 10 },
    // 宿舍右侧墙
    { minX: -1.7, maxX: -1, minZ: 2, maxZ: 10 },
    // 宿舍后墙（门的左右两侧）
    { minX: -7, maxX: -5.5, minZ: 9.5, maxZ: 10.5 },
    { minX: -3.5, maxX: -1, minZ: 9.5, maxZ: 10.5 },
  ];

  const pickupMat = (color: number) => {
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.75, roughness: 0.3 });
    materials.push(mat);
    return mat;
  };
  const makePickup = (id: string, name: string, position: { x: number; z: number }, color: number): Pickup => {
    const group = new THREE.Group();
    group.name = `fallback_${id}`;
    group.position.set(position.x, 0.78, position.z);
    root.add(group);
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 1), pickupMat(color));
    geometries.push(core.geometry);
    group.add(core);
    const haloMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false });
    materials.push(haloMat);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), haloMat);
    geometries.push(halo.geometry);
    group.add(halo);
    const light = new THREE.PointLight(color, 1.8, 4.5, 2);
    group.add(light);
    return { id, itemId: id, name, glow: group, position: group.position.clone(), radius: 0.78, taken: false };
  };

  // 老照片 — 宿舍桌面上随机位置
  const photo = makePickup("photograph", "苏婉的老照片", PHOTO_SPOTS[photoAnchor % PHOTO_SPOTS.length], 0xffd37c);
  // 能量饮料 — 走廊右段
  const energy = makePickup("energy", "能量饮料", { x: 10, z: 22 }, 0xff4f3c);
  energy.glow.visible = false;

  // 导航图：宿舍 → 门 → 走廊 → 出口
  const guideNodes: InteriorGuideNode[] = [
    { id: "dorm-center", x: -4.5, z: 4, links: ["dorm-door"] },
    { id: "dorm-door", x: -4.5, z: 9.5, links: ["dorm-center", "corridor-left"] },
    { id: "corridor-left", x: -5, z: 12, links: ["dorm-door", "corridor-mid"] },
    { id: "corridor-mid", x: 5, z: 16, links: ["corridor-left", "corridor-energy"] },
    { id: "corridor-energy", x: 10, z: 22, links: ["corridor-mid", "exit"] },
    { id: "exit", x: 22, z: 24, links: ["corridor-energy"] },
  ];

  // 可步行矩形 — 一个连续的大矩形覆盖全部可玩区域，
  // 外墙由 AABB colliders 阻挡，避免产生空气墙。
  const isWalkable = (x: number, z: number) =>
    x >= -8 && x <= 28 && z >= 2 && z <= 26;

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
    bounds: { minX: -10, maxX: 30, minZ: -2, maxZ: 28 },
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
