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
  const colliders: AABB[] = [
    // 门禁：初始锁住，拾取照片后打开
    { minX: -5.5, maxX: -3.5, minZ: 9.3, maxZ: 10.3, gateId: "baisha-entry" },
    // 捷径门：cut-off 阶段打开
    { minX: -9, maxX: -6.5, minZ: 16, maxZ: 18, gateId: "baisha-shortcut" },

    // ── 外墙：基于 GLB 实际几何位置 ──
    // 走廊左边界 (x≈-7.5)
    { minX: -8, maxX: -7.3, minZ: 9.5, maxZ: 26 },
    // 走廊右边界 (x≈26.5)
    { minX: 26.5, maxX: 27.5, minZ: 9.5, maxZ: 26 },
    // 走廊远端墙 (z≈25)
    { minX: -8, maxX: 27.5, minZ: 25.5, maxZ: 26.5 },
    // 宿舍左墙 (x≈-7.5)
    { minX: -8, maxX: -7.3, minZ: 0, maxZ: 9.5 },
    // 宿舍右墙 (x≈-1.5)
    { minX: -2, maxX: -1.3, minZ: 0, maxZ: 9.5 },
    // 宿舍前墙 (z≈0)
    { minX: -8, maxX: -1.3, minZ: -1, maxZ: 0.5 },
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
  const energy = makePickup("energy", "能量饮料", { x: 10, z: 22 }, 0xff4f3c);
  energy.glow.visible = false;

  const guideNodes: InteriorGuideNode[] = [
    { id: "dorm-center", x: -4.5, z: 4, links: ["dorm-door"] },
    { id: "dorm-door", x: -4.5, z: 9.5, links: ["dorm-center", "corridor-left"] },
    { id: "corridor-left", x: -5, z: 12, links: ["dorm-door", "corridor-mid"] },
    { id: "corridor-mid", x: 5, z: 16, links: ["corridor-left", "corridor-energy"] },
    { id: "corridor-energy", x: 10, z: 22, links: ["corridor-mid", "exit"] },
    { id: "exit", x: 22, z: 24, links: ["corridor-energy"] },
  ];

  // 关闭 isWalkable 软约束，避免空气墙。外墙由 colliders 阻挡，bounds 做最终 clamp。
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
    bounds: { minX: -11, maxX: 31, minZ: -2, maxZ: 29 },
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
