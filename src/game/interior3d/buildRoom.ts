import * as THREE from "three";
import { buildCharacter, type CharacterHandle } from "./buildCharacter";

/** Room archetypes with distinct furniture layouts. */
export type RoomKind = "library" | "medical" | "dorm" | "hall";

/** Axis-aligned bounding box on the floor plane (XZ). Used for collision. */
export interface AABB {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** A glowing, collectable item on the floor. */
export interface Pickup {
  id: string;
  itemId: string;
  name: string;
  glow: THREE.Object3D;
  position: THREE.Vector3;
  radius: number;
  taken: boolean;
}

export interface RoomBuildResult {
  /** Group holding all room + furniture + NPC meshes. Add to the scene. */
  root: THREE.Group;
  /** Solid furniture / wall footprints the player must not pass through. */
  colliders: AABB[];
  /** Inner playable bounds (already inset from the walls). */
  bounds: AABB;
  /** Per-frame update: NPC idle + horror reveal + pickup bob. `t` seconds. */
  update: (t: number, playerPos: THREE.Vector3) => void;
  /** Ground height under a world XZ position (0 on the ground floor). */
  floorHeightAt: (x: number, z: number) => number;
  /** Collectable items still in the room. */
  pickups: Pickup[];
  /** Suggested spawn point for the camera. */
  spawn: THREE.Vector3;
  /** Free all geometries + materials. */
  dispose: () => void;
}

/** Map a building id / zone onto a room archetype. */
export function classifyRoom(id: string, zone?: string): RoomKind {
  const key = `${id} ${zone ?? ""}`.toLowerCase();
  if (/lib|book|图书|阅览/.test(key)) return "library";
  if (/med|hospital|clinic|医|health|病/.test(key)) return "medical";
  if (/dorm|hostel|宿舍|寝|baisha|白沙/.test(key)) return "dorm";
  return "hall";
}

interface Palette {
  floor: number;
  wall: number;
  ceiling: number;
  accent: number;
  wood: number;
}

const PALETTES: Record<RoomKind, Palette> = {
  // Library uses the real ZJU library's blue/white scheme, dimmed for horror.
  library: { floor: 0x1b2733, wall: 0x28323d, ceiling: 0x0e141b, accent: 0x8fb8d6, wood: 0x6b4b2e },
  medical: { floor: 0x20262a, wall: 0x2b333a, ceiling: 0x12171b, accent: 0x6fa6ad, wood: 0x4a4038 },
  dorm: { floor: 0x2b333d, wall: 0x3b3a3f, ceiling: 0x17161a, accent: 0x5f7fa8, wood: 0x9a744a },
  hall: { floor: 0x22242a, wall: 0x2c2f37, ceiling: 0x14161b, accent: 0x8a8fa0, wood: 0x5a4a38 },
};

// Which useful story item each archetype hands out. key_card / photograph /
// cat_hair are required by later story choices; the rest are consumables.
const ROOM_ITEMS: Record<RoomKind, { itemId: string; name: string }[]> = {
  library: [
    { itemId: "cat_hair", name: "黑猫毛发" },
    { itemId: "diary", name: "日记残页" },
  ],
  medical: [
    { itemId: "key_card", name: "门禁卡" },
    { itemId: "medicine", name: "镇定药" },
  ],
  dorm: [
    { itemId: "photograph", name: "老照片" },
    { itemId: "energy", name: "能量饮料" },
  ],
  hall: [{ itemId: "talisman", name: "护身符" }],
};

const WALL_T = 0.28;

export function buildRoom(kind: RoomKind): RoomBuildResult {
  const root = new THREE.Group();
  root.name = `room-${kind}`;

  const palette = PALETTES[kind];
  const colliders: AABB[] = [];
  const npcs: CharacterHandle[] = [];
  const pickups: Pickup[] = [];

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const track = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };
  const stdMat = (color: number, rough = 0.9, metal = 0.04): THREE.MeshStandardMaterial =>
    trackMat(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));

  const floorMat = stdMat(palette.floor, 0.96);
  const wallMat = stdMat(palette.wall);
  const ceilMat = stdMat(palette.ceiling);
  const woodMat = stdMat(palette.wood, 0.8);
  const accentMat = stdMat(palette.accent, 0.55, 0.1);
  const metalMat = stdMat(0x3f444b, 0.4, 0.55);
  const whiteMat = stdMat(0xd7dee4, 0.5, 0.15);
  const fabricMat = stdMat(0x394152, 0.95);

  // Box helper: places a mesh and (optionally) records a collider footprint.
  const addBox = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
    solid = true,
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(track(new THREE.BoxGeometry(w, h, d)), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    if (solid) {
      colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
    }
    return mesh;
  };

  // A proper 4-legged table (fixes the old "table with 2 legs" look).
  const addTable = (cx: number, cz: number, w: number, d: number, topY: number, mat: THREE.Material): void => {
    addBox(w, 0.08, d, cx, topY, cz, mat, false);
    const lx = w / 2 - 0.12;
    const lz = d / 2 - 0.12;
    const legH = topY - 0.04;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        addBox(0.09, legH, 0.09, cx + sx * lx, legH / 2, cz + sz * lz, woodMat, false);
      }
    }
    colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
  };

  const addChair = (cx: number, cz: number, mat: THREE.Material): void => {
    addBox(0.42, 0.06, 0.42, cx, 0.46, cz, mat, false);
    addBox(0.42, 0.5, 0.06, cx, 0.72, cz - 0.18, mat, false);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) addBox(0.06, 0.46, 0.06, cx + sx * 0.16, 0.23, cz + sz * 0.16, woodMat, false);
  };

  // A tall bookshelf full of colourful spines.
  const addBookshelf = (cx: number, cz: number, w: number, rot: number, baseY = 0): void => {
    const g = new THREE.Group();
    g.position.set(cx, baseY, cz);
    g.rotation.y = rot;
    root.add(g);
    const H = 2.5;
    const frame = new THREE.Mesh(track(new THREE.BoxGeometry(w, H, 0.4)), woodMat);
    frame.position.y = H / 2;
    frame.castShadow = true;
    g.add(frame);
    const spineColors = [0x7a3b34, 0x35506b, 0x5c6b3a, 0x6b5a35, 0x45364f, 0x2f5a55];
    const count = Math.floor(w / 0.13);
    for (let shelf = 0; shelf < 4; shelf++) {
      const y = 0.35 + shelf * 0.6;
      for (let b = 0; b < count; b++) {
        const bw = 0.07 + (b % 3) * 0.02;
        const bh = 0.34 + ((b * 7) % 5) * 0.03;
        const bm = stdMat(spineColors[(b + shelf) % spineColors.length], 0.9);
        const book = new THREE.Mesh(track(new THREE.BoxGeometry(bw, bh, 0.24)), bm);
        book.position.set(-w / 2 + 0.1 + b * 0.13, y + bh / 2, 0.02);
        g.add(book);
      }
    }
    const cw = Math.abs(Math.cos(rot)) * w + Math.abs(Math.sin(rot)) * 0.4;
    const cd = Math.abs(Math.sin(rot)) * w + Math.abs(Math.cos(rot)) * 0.4;
    colliders.push({ minX: cx - cw / 2, maxX: cx + cw / 2, minZ: cz - cd / 2, maxZ: cz + cd / 2 });
  };

  // A glowing collectable item (floats + bobs, auto-collected on approach).
  const addPickup = (itemId: string, name: string, x: number, y: number, z: number, color: number): void => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    root.add(g);
    const coreMat = trackMat(
      new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color), emissiveIntensity: 1.6, roughness: 0.35 }),
    );
    const core = new THREE.Mesh(track(new THREE.IcosahedronGeometry(0.12, 0)), coreMat);
    g.add(core);
    const haloMat = trackMat(
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
    );
    const halo = new THREE.Mesh(track(new THREE.SphereGeometry(0.3, 12, 12)), haloMat);
    g.add(halo);
    const light = new THREE.PointLight(color, 1.1, 3.2, 2);
    g.add(light);
    pickups.push({
      id: `${itemId}-${pickups.length}`,
      itemId,
      name,
      glow: g,
      position: new THREE.Vector3(x, y, z),
      radius: 0.9,
      taken: false,
    });
  };

  // Shared finalizer (hoisted). Closes over root/npcs/pickups/geometries/materials.
  function finalize(
    bounds: AABB,
    spawn: THREE.Vector3,
    floorHeightAt: (x: number, z: number) => number,
    opts: { revealZ: number; revealFloor2: boolean; revealNear?: { x: number; z: number; r: number } },
  ): RoomBuildResult {
    let revealed = false;
    const update = (t: number, playerPos: THREE.Vector3): void => {
      if (!revealed) {
        const deep = opts.revealFloor2
          ? floorHeightAt(playerPos.x, playerPos.z) > 1.4
          : opts.revealNear
            ? Math.hypot(playerPos.x - opts.revealNear.x, playerPos.z - opts.revealNear.z) < opts.revealNear.r
            : playerPos.z < opts.revealZ;
        if (deep) {
          revealed = true;
          for (const n of npcs) n.group.visible = true;
        }
      }
      for (const n of npcs) if (n.group.visible) n.update(t);
      for (const p of pickups) {
        if (p.taken) continue;
        p.glow.rotation.y = t * 1.4;
        p.glow.position.y = p.position.y + Math.sin(t * 2.2 + p.position.x) * 0.08;
      }
    };
    const dispose = (): void => {
      for (const n of npcs) n.dispose();
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      root.clear();
    };
    return { root, colliders, bounds, update, floorHeightAt, pickups, spawn, dispose };
  }

  // ---------------------------------------------------------------- LIBRARY
  if (kind === "library") {
    const built = buildLibrary({
      root,
      addBox,
      addBookshelf,
      track,
      trackMat,
      floorMat,
      ceilMat,
      wallMat,
      whiteMat,
      metalMat,
      accentMat,
      colliders,
    });
    const npc = buildCharacter({ bodyColor: 0x161b22, skinColor: 0xb7c2c9 });
    npc.group.position.set(built.npc.x, built.npc.y, built.npc.z);
    npc.group.rotation.y = built.npc.ry;
    npc.group.visible = false;
    root.add(npc.group);
    npcs.push(npc);

    ROOM_ITEMS.library.forEach((it, i) => {
      const p = built.pickupSpots[i] ?? built.pickupSpots[0];
      addPickup(it.itemId, it.name, p.x, p.y, p.z, i === 0 ? 0x8fd0ff : 0xffd27a);
    });

    return finalize(built.bounds, built.spawn, built.floorHeightAt, { revealZ: -99, revealFloor2: true });
  }

  // -------------------------------------------------- FLAT ROOMS (non-library)
  const ROOM_W = 8.5;
  const ROOM_L = 15;
  const WALL_H = 3.2;
  const halfW = ROOM_W / 2;
  const halfL = ROOM_L / 2;

  const floor = new THREE.Mesh(track(new THREE.PlaneGeometry(ROOM_W, ROOM_L)), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  root.add(floor);
  const ceil = new THREE.Mesh(track(new THREE.PlaneGeometry(ROOM_W, ROOM_L)), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = WALL_H;
  root.add(ceil);
  addBox(ROOM_W + WALL_T, WALL_H, WALL_T, 0, WALL_H / 2, -halfL, wallMat);
  addBox(ROOM_W + WALL_T, WALL_H, WALL_T, 0, WALL_H / 2, halfL, wallMat);
  addBox(WALL_T, WALL_H, ROOM_L + WALL_T, -halfW, WALL_H / 2, 0, wallMat);
  addBox(WALL_T, WALL_H, ROOM_L + WALL_T, halfW, WALL_H / 2, 0, wallMat);
  addBox(2.4, 0.35, 0.2, 0, WALL_H - 0.2, -halfL + 0.3, accentMat, false);

  // Entrance mundane props (visible immediately so it never looks unloaded).
  addBox(1.6, 0.02, 1.0, 0, 0.011, halfL - 1.3, fabricMat, false);
  addBox(0.5, 0.9, 0.5, halfW - 1.0, 0.45, halfL - 1.4, metalMat);

  if (kind === "medical") {
    for (let i = 0; i < 3; i++) {
      const z = -3.5 + i * 3.6;
      addBox(1.0, 0.5, 2.0, -halfW + 1.3, 0.3, z, metalMat);
      addBox(1.0, 0.14, 1.9, -halfW + 1.3, 0.6, z, stdMat(0x9fb4b0, 0.85), false);
      addBox(0.9, 0.7, 0.06, -halfW + 1.3, 1.0, z - 0.9, whiteMat, false);
    }
    addBox(1.0, 1.5, 0.6, halfW - 1.1, 0.75, -2.5, metalMat);
    addBox(1.0, 1.5, 0.6, halfW - 1.1, 0.75, 1.5, metalMat);
    addTable(halfW - 2.6, 4.2, 1.1, 0.7, 0.78, whiteMat);
    addChair(halfW - 2.6, 5.0, fabricMat);
    addBox(0.6, 0.9, 0.6, 1.4, 0.45, halfL - 3.0, metalMat);
  } else if (kind === "dorm") {
    // ── 浙大白沙式"上床下桌":上层黑色金属高架床，下层木书桌+书架柜+绿椅+爬梯 ──
    const blueFabric = stdMat(0x3f5a86, 0.95); // 蓝色被褥/窗帘
    const greenSeat = stdMat(0x5f8f52, 0.75); // 绿色塑料椅
    const spineCols = [0x7a3b34, 0x35506b, 0x5c6b3a, 0x6b5a35, 0x45364f];
    const addLoftDesk = (cx: number, cz: number, faceX: number): void => {
      const bedY = 1.55;
      // 高架床板 + 蓝色被褥
      addBox(1.25, 0.1, 2.0, cx, bedY, cz, woodMat, false);
      addBox(1.15, 0.16, 1.9, cx, bedY + 0.13, cz, blueFabric, false);
      // 黑色金属床架:四立柱 + 顶部横杆 + 开口侧护栏
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) addBox(0.06, 2.1, 0.06, cx + sx * 0.58, 1.05, cz + sz * 0.95, metalMat, false);
      addBox(1.25, 0.05, 0.05, cx, 2.05, cz - 0.95, metalMat, false);
      addBox(1.25, 0.05, 0.05, cx, 2.05, cz + 0.95, metalMat, false);
      addBox(0.05, 0.42, 1.9, cx + faceX * 0.58, 1.9, cz, metalMat, false);
      // 下层书桌(木) + 桌腿
      addBox(1.15, 0.06, 0.62, cx, 0.75, cz, woodMat, false);
      for (const sz of [-1, 1]) addBox(0.07, 0.72, 0.07, cx - faceX * 0.5, 0.36, cz + sz * 0.24, woodMat, false);
      // 桌上书架隔板 + 几本书
      addBox(1.15, 0.05, 0.5, cx, 1.12, cz, woodMat, false);
      for (let b = 0; b < 6; b++) addBox(0.09, 0.26, 0.2, cx - 0.5 + b * 0.17, 1.3, cz, stdMat(spineCols[b % spineCols.length], 0.9), false);
      // 桌下柜/抽屉
      addBox(0.5, 0.66, 0.55, cx - faceX * 0.3, 0.35, cz + 0.6, woodMat, false);
      // 金属爬梯(靠开口侧的一端)
      addBox(0.04, 1.55, 0.04, cx + faceX * 0.52, 0.8, cz - 0.72, metalMat, false);
      addBox(0.04, 1.55, 0.04, cx + faceX * 0.52, 0.8, cz - 0.95, metalMat, false);
      for (const yy of [0.45, 0.85, 1.25]) addBox(0.04, 0.04, 0.28, cx + faceX * 0.52, yy, cz - 0.83, metalMat, false);
      // 绿椅
      addChair(cx + faceX * 0.95, cz + 0.3, greenSeat);
      colliders.push({ minX: cx - 0.7, maxX: cx + 0.7, minZ: cz - 1.0, maxZ: cz + 1.0 });
    };
    // 左墙两组、右墙后段一组(右墙前段留给镜子)
    addLoftDesk(-halfW + 1.1, -3.6, 1);
    addLoftDesk(-halfW + 1.1, 0.4, 1);
    addLoftDesk(halfW - 1.1, -4.4, -1);
    // 蓝色窗帘(后墙"窗户")
    addBox(3.0, 2.0, 0.06, -0.8, 1.7, -halfL + 0.16, blueFabric, false);
    // 木衣柜(靠近入口右侧)
    addBox(0.85, 2.05, 0.62, halfW - 0.7, 1.02, halfL - 2.2, woodMat);
    // ── 镜子(右墙中前段):靠近先见自己倒影,随后红眼鬼现形 ──
    const mirrorZ = -1.2;
    addBox(0.06, 1.5, 0.9, halfW - 0.22, 1.45, mirrorZ, woodMat, false); // 镜框
    const glass = trackMat(new THREE.MeshStandardMaterial({ color: 0x9fb0bd, roughness: 0.12, metalness: 0.85 }));
    addBox(0.02, 1.3, 0.72, halfW - 0.27, 1.45, mirrorZ, glass, false); // 镜面
  } else {
    addBox(3.2, 0.5, 0.8, 0, 0.25, -2.5, woodMat);
    addBox(3.2, 0.5, 0.8, 0, 0.25, 2.5, woodMat);
    for (const sx of [-1, 1]) {
      addBox(0.5, 3.2, 0.5, sx * (halfW - 1.2), 1.6, -1.0, accentMat);
      addBox(0.5, 3.2, 0.5, sx * (halfW - 1.2), 1.6, 3.0, accentMat);
    }
    addTable(0, halfL - 3.5, 2.0, 0.8, 0.9, woodMat);
  }

  // Deep horror figure (hidden until the player walks in / approaches the mirror).
  const npc = buildCharacter({
    bodyColor: kind === "medical" ? 0xaeb4b8 : 0x14181e,
    skinColor: kind === "medical" ? 0xcdc7bb : 0xb9a894,
  });
  let revealNear: { x: number; z: number; r: number } | undefined;
  if (kind === "dorm") {
    // 红眼鬼站在镜前,面向玩家;靠近镜子时现形(先照见自己,再看见鬼)。
    npc.group.position.set(halfW - 1.35, 0, -1.2);
    npc.group.rotation.y = -Math.PI / 2;
    revealNear = { x: halfW - 1.6, z: -1.2, r: 2.4 };
  } else {
    const npcZ = -halfL + 1.6;
    npc.group.position.set(0.2, 0, npcZ);
    npc.group.rotation.y = 0;
    colliders.push({ minX: -0.5, maxX: 0.7, minZ: npcZ - 0.5, maxZ: npcZ + 0.5 });
  }
  npc.group.visible = false;
  root.add(npc.group);
  npcs.push(npc);

  // Pickups on open, reachable floor (avoid furniture footprints per room).
  const items = ROOM_ITEMS[kind];
  const spotsByKind: Record<string, { x: number; z: number }[]> = {
    medical: [{ x: 1.6, z: 2.2 }, { x: -1.4, z: -1.2 }],
    dorm: [{ x: 0, z: 2.6 }, { x: 1.8, z: 1.4 }],
    hall: [{ x: -2.4, z: 0.2 }, { x: 2.4, z: 0.2 }],
  };
  const spots = spotsByKind[kind] ?? spotsByKind.hall;
  items.forEach((it, i) => {
    const s = spots[i] ?? spots[0];
    addPickup(it.itemId, it.name, s.x, 0.75, s.z, i === 0 ? 0xffe08a : 0x8fd0ff);
  });

  const bounds: AABB = {
    minX: -halfW + WALL_T,
    maxX: halfW - WALL_T,
    minZ: -halfL + WALL_T,
    maxZ: halfL - WALL_T,
  };
  const spawn = new THREE.Vector3(0, 1.6, halfL - 1.2);
  const revealZ = halfL - 6;

  return finalize(bounds, spawn, () => 0, { revealZ, revealFloor2: false, revealNear });
}

// ============================================================ LIBRARY BUILDER
interface LibCtx {
  root: THREE.Group;
  addBox: (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, solid?: boolean) => THREE.Mesh;
  addBookshelf: (cx: number, cz: number, w: number, rot: number, baseY?: number) => void;
  track: <T extends THREE.BufferGeometry>(g: T) => T;
  trackMat: <T extends THREE.Material>(m: T) => T;
  floorMat: THREE.Material;
  ceilMat: THREE.Material;
  wallMat: THREE.Material;
  whiteMat: THREE.Material;
  metalMat: THREE.Material;
  accentMat: THREE.Material;
  colliders: AABB[];
}

interface LibResult {
  bounds: AABB;
  spawn: THREE.Vector3;
  floorHeightAt: (x: number, z: number) => number;
  npc: { x: number; y: number; z: number; ry: number };
  pickupSpots: { x: number; y: number; z: number }[];
}

/**
 * Two-storey library modelled on the real ZJU basic library: turnstile gate at
 * the +Z entrance, bookshelf rows, and a white spiral staircase (centre-back)
 * rising one full turn to a 2nd-floor gallery where the figure waits.
 */
function buildLibrary(ctx: LibCtx): LibResult {
  const { addBox, addBookshelf, track, trackMat, floorMat, ceilMat, wallMat, whiteMat, metalMat, accentMat, root, colliders } = ctx;
  const W = 12;
  const L = 18;
  const H1 = 3.4;
  const WALL_H = H1 * 2;
  const halfW = W / 2;
  const halfL = L / 2;

  const floor = new THREE.Mesh(track(new THREE.PlaneGeometry(W, L)), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  root.add(floor);
  const ceil = new THREE.Mesh(track(new THREE.PlaneGeometry(W, L)), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = WALL_H;
  root.add(ceil);
  addBox(W + 0.3, WALL_H, 0.3, 0, WALL_H / 2, -halfL, wallMat);
  addBox(W + 0.3, WALL_H, 0.3, 0, WALL_H / 2, halfL, wallMat);
  addBox(0.3, WALL_H, L + 0.3, -halfW, WALL_H / 2, 0, wallMat);
  addBox(0.3, WALL_H, L + 0.3, halfW, WALL_H / 2, 0, wallMat);

  // Turnstile gate at the entrance (+Z).
  const gateZ = halfL - 2.2;
  for (const sx of [-1.1, 0, 1.1]) addBox(0.5, 1.0, 0.5, sx, 0.5, gateZ, metalMat);
  for (const sx of [-0.55, 0.55]) addBox(0.06, 0.1, 0.9, sx, 0.95, gateZ, whiteMat, false);
  addBox(W, 0.3, 0.3, 0, 2.6, gateZ, whiteMat, false);

  // Bookshelf rows down both sides of the ground floor.
  for (let i = 0; i < 3; i++) {
    const z = -4 + i * 3.2;
    addBookshelf(-halfW + 1.4, z, 3.0, Math.PI / 2);
    addBookshelf(halfW - 1.4, z, 3.0, Math.PI / 2);
  }
  // Reading table between the rows (4 legs).
  addBox(2.0, 0.08, 1.0, 0, 0.78, 4.5, accentMat, false);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) addBox(0.09, 0.74, 0.09, sx * 0.85, 0.37, 4.5 + sz * 0.4, metalMat, false);
  colliders.push({ minX: -1.1, maxX: 1.1, minZ: 4.0, maxZ: 5.0 });

  // ── Half-turn (180°) spiral staircase on the -X side ──
  // Bottom faces the +Z entrance; the flight curves around the central column
  // and tops out at the back (-Z), stepping straight onto the mezzanine. A
  // half turn keeps top & bottom at *different* positions, so it is a valid
  // position→height field (a full turn would make top and bottom coincide and
  // become unreachable). The solid central column blocks the x=0 shortcut, so
  // the only path up is around the visible steps.
  const SX = 0;
  const SZ = -5;
  const R_IN = 0.7;
  const R_OUT = 1.9;
  const rMid = (R_IN + R_OUT) / 2;
  const ENTRY = Math.PI / 2; // bottom step at +Z side of the column
  const TURN = Math.PI; // 180°
  const F2Y = H1; // mezzanine height
  const MEZZ_Z = -6.2; // everything behind this line is the 2nd-floor mezzanine

  // Central column.
  const col = new THREE.Mesh(track(new THREE.CylinderGeometry(R_IN, R_IN, F2Y + 0.2, 20)), whiteMat);
  col.position.set(SX, (F2Y + 0.2) / 2, SZ);
  root.add(col);
  colliders.push({ minX: SX - R_IN, maxX: SX + R_IN, minZ: SZ - R_IN, maxZ: SZ + R_IN });

  // Treads + outer railing posts along the walkable half (a: 0 → π).
  const STEPS = 16;
  for (let i = 0; i <= STEPS; i++) {
    const a = ENTRY + (i / STEPS) * TURN;
    const y = (i / STEPS) * F2Y + 0.06;
    const tread = new THREE.Mesh(track(new THREE.BoxGeometry(R_OUT - R_IN + 0.2, 0.1, 0.62)), whiteMat);
    tread.position.set(SX + Math.cos(a) * rMid, y, SZ + Math.sin(a) * rMid);
    tread.rotation.y = -a;
    tread.castShadow = true;
    root.add(tread);
    if (i % 2 === 0) {
      const post = new THREE.Mesh(track(new THREE.CylinderGeometry(0.028, 0.028, 1.0, 6)), whiteMat);
      post.position.set(SX + Math.cos(a) * (R_OUT + 0.05), y + 0.5, SZ + Math.sin(a) * (R_OUT + 0.05));
      root.add(post);
    }
  }

  // ── Mezzanine slab (everything behind MEZZ_Z), at y = F2Y ──
  const galleryMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x22323f, roughness: 0.9 }));
  const mezzD = MEZZ_Z - (-halfL); // depth from back wall to the front edge
  const mezz = new THREE.Mesh(track(new THREE.BoxGeometry(W - 0.3, 0.25, mezzD)), galleryMat);
  mezz.position.set(0, F2Y - 0.125, (-halfL + MEZZ_Z) / 2);
  mezz.receiveShadow = true;
  root.add(mezz);

  // Mezzanine front railing, with a gap at x∈[-1,1] where the stairs arrive.
  addBox(halfW - 1.0, 0.9, 0.12, -(1 + (halfW - 1) / 2), F2Y + 0.45, MEZZ_Z, whiteMat, false);
  addBox(halfW - 1.0, 0.9, 0.12, 1 + (halfW - 1) / 2, F2Y + 0.45, MEZZ_Z, whiteMat, false);
  // Rail-height side blockers so you can't walk off the mezzanine sides.
  colliders.push({ minX: -halfW + 0.2, maxX: -halfW + 0.35, minZ: -halfL, maxZ: MEZZ_Z });
  colliders.push({ minX: halfW - 0.35, maxX: halfW - 0.2, minZ: -halfL, maxZ: MEZZ_Z });
  // Front-edge blocker (except the stair gap) so you don't fall off the front.
  colliders.push({ minX: -halfW + 0.3, maxX: -1, minZ: MEZZ_Z - 0.15, maxZ: MEZZ_Z });
  colliders.push({ minX: 1, maxX: halfW - 0.3, minZ: MEZZ_Z - 0.15, maxZ: MEZZ_Z });

  // Mezzanine bookshelves (raised onto the slab).
  addBookshelf(-halfW + 1.5, -7.6, 2.6, Math.PI / 2, F2Y);
  addBookshelf(halfW - 1.5, -7.6, 2.6, Math.PI / 2, F2Y);

  const floorHeightAt = (x: number, z: number): number => {
    const dx = x - SX;
    const dz = z - SZ;
    const r = Math.hypot(dx, dz);
    // On the walkable stair half → helix height.
    if (r >= R_IN - 0.2 && r <= R_OUT + 0.25) {
      let a = Math.atan2(dz, dx) - ENTRY;
      a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      if (a <= TURN + 0.02) return THREE.MathUtils.clamp((a / TURN) * F2Y, 0, F2Y);
    }
    // Behind the front edge → mezzanine.
    if (z <= MEZZ_Z && Math.abs(x) < halfW - 0.3) return F2Y;
    return 0;
  };

  const bounds: AABB = { minX: -halfW + 0.3, maxX: halfW - 0.3, minZ: -halfL + 0.3, maxZ: halfL - 0.3 };
  const spawn = new THREE.Vector3(0, 1.6, halfL - 0.9);

  return {
    bounds,
    spawn,
    floorHeightAt,
    npc: { x: 0.4, y: F2Y, z: -7.9, ry: 0 }, // on the mezzanine, facing the stairs
    pickupSpots: [
      { x: -halfW + 1.5, y: 0.7, z: 3.2 }, // ground floor, front-left
      { x: -3.0, y: F2Y + 0.7, z: -7.4 }, // upstairs on the mezzanine
    ],
  };
}
