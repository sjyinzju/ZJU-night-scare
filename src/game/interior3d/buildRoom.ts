import * as THREE from "three";
import { buildCharacter, type CharacterHandle } from "./buildCharacter";
import { DoorComponent } from "./DoorComponent";
import { buildStraightStairs, buildLStairs } from "./StaircaseBuilder";
import { RoomDivider } from "./RoomDivider";
import { woodTexture, floorTexture, tileTexture, wallTexture, fabricTexture, metalTexture } from "./textures";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";

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

/** A red-glowing story-trigger zone inside the 3D interior. Walk in → text popup. */
export interface StoryTrigger {
  id: string;
  sceneId: string;
  glow: THREE.Object3D;
  position: THREE.Vector3;
  radius: number;
  triggered: boolean;
}

export interface RoomBuildResult {
  /** Group holding all room + furniture + NPC meshes. Add to the scene. */
  root: THREE.Group;
  /** Solid furniture / wall footprints the player must not pass through. */
  colliders: AABB[];
  /** Inner playable bounds (already inset from the walls). */
  bounds: AABB;
  /** Per-frame update: NPC idle + horror reveal + pickup bob + door rotation. `t` seconds. */
  update: (t: number, playerPos: THREE.Vector3) => void;
  /** Ground height under a world XZ position (0 on the ground floor). */
  floorHeightAt: (x: number, z: number) => number;
  /** Collectable items still in the room. */
  pickups: Pickup[];
  /** Story-trigger zones the player can walk into. */
  storyTriggers: StoryTrigger[];
  /** Interactive doors in this room. */
  doors: DoorComponent[];
  /** Suggested spawn point for the camera. */
  spawn: THREE.Vector3;
  /** Free all geometries + materials. */
  dispose: () => void;
}

/** Map a building id / zone onto a room archetype. */
export function classifyRoom(id: string, zone?: string): RoomKind {
  const key = `${id} ${zone ?? ""}`.toLowerCase();
  // 医学分馆是图书馆，不是医院——用 library 布局（螺旋楼梯）
  if (/medical-library/.test(key)) return "library";
  if (/dorm|hostel|宿舍|寝|baisha|白沙/.test(key)) return "dorm";
  if (/medical|med|hospital|clinic|医|health|病/.test(key)) return "medical";
  if (/library|lib|book|图书|阅览/.test(key)) return "library";
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

/** Dispatch a window CustomEvent, guarded for non-DOM (Node build/test) envs. */
function emit(name: string, detail: unknown): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function buildRoom(kind: RoomKind): RoomBuildResult {
  const root = new THREE.Group();
  root.name = `room-${kind}`;

  const palette = PALETTES[kind];
  const colliders: AABB[] = [];
  const npcs: CharacterHandle[] = [];
  const pickups: Pickup[] = [];
  const storyTriggers: StoryTrigger[] = [];
  const doors: DoorComponent[] = [];
  // Per-frame ambient animators (flickering lights, a slowly rolling gurney …).
  const animators: Array<(t: number) => void> = [];
  // Extra GPU resources (e.g. mirror Reflector render targets) to free on dispose.
  const reflectorDisposers: Array<() => void> = [];

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
  // Give a material a procedural texture map for "质感" (grain/wood/tile). The
  // texture already bakes in the base colour, so we tint the material white so
  // it shows at full. Returns null-safe (no-op in a non-DOM build/test env).
  const withTex = (m: THREE.MeshStandardMaterial, tex: THREE.Texture | null): THREE.MeshStandardMaterial => {
    if (tex) {
      m.map = tex;
      m.color.set(0xffffff);
    }
    return m;
  };

  const floorMat = withTex(stdMat(palette.floor, 0.96), kind === "dorm" ? floorTexture(palette.floor) : tileTexture(palette.floor));
  const wallMat = withTex(stdMat(palette.wall), wallTexture(palette.wall));
  const ceilMat = stdMat(palette.ceiling);
  const woodMat = withTex(stdMat(palette.wood, 0.82), woodTexture(palette.wood));
  const accentMat = withTex(stdMat(palette.accent, 0.55, 0.1), fabricTexture(palette.accent));
  const metalMat = withTex(stdMat(0x3f444b, 0.4, 0.55), metalTexture(0x3f444b));
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

  // A red glowing story-trigger zone. Player walks in → text popup in the 3D interior.
  const addStoryTrigger = (sceneId: string, x: number, y: number, z: number): void => {
    const color = 0xd04438;
    const g = new THREE.Group();
    g.position.set(x, y, z);
    root.add(g);
    const coreMat = trackMat(
      new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color), emissiveIntensity: 2.0, roughness: 0.3 }),
    );
    const core = new THREE.Mesh(track(new THREE.IcosahedronGeometry(0.18, 0)), coreMat);
    g.add(core);
    const haloMat = trackMat(
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }),
    );
    const halo = new THREE.Mesh(track(new THREE.SphereGeometry(0.5, 16, 16)), haloMat);
    g.add(halo);
    const light = new THREE.PointLight(color, 1.5, 4.5, 2);
    g.add(light);
    storyTriggers.push({
      id: `${sceneId}-${storyTriggers.length}`,
      sceneId,
      glow: g,
      position: new THREE.Vector3(x, y, z),
      radius: 1.2,
      triggered: false,
    });
  };

  // Shared finalizer (hoisted). Closes over root/npcs/pickups/storyTriggers/geometries/materials.
  function finalize(
    bounds: AABB,
    spawn: THREE.Vector3,
    floorHeightAt: (x: number, z: number) => number,
    opts: {
      revealZ: number;
      revealFloor2: boolean;
      revealNear?: { x: number; z: number; r: number };
      /** Dorm mirror scare: reveal the figure at this spot, dim, then jumpscare when the player moves/turns away. */
      mirrorScare?: { x: number; z: number };
    },
  ): RoomBuildResult {
    let revealed = false;
    let scareFired = false;
    const revealPos = new THREE.Vector3();
    let revealT = 0;
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
          if (opts.mirrorScare) {
            // 走到镜前红点的一刻:鬼在镜中现形 + 视野压暗。
            revealPos.copy(playerPos);
            revealT = t;
            emit("zju-horror-interior-dim", { on: true });
          }
        }
      }
      // 转身/往旁边挪(离开镜前) → 鬼扑到脸前跳脸。留一个 2.6s 兜底,始终会触发。
      if (revealed && opts.mirrorScare && !scareFired) {
        const moved = playerPos.distanceTo(revealPos) > 0.8 || t - revealT > 2.6;
        if (moved) {
          scareFired = true;
          for (const n of npcs) {
            n.group.position.set(playerPos.x, 0, playerPos.z + 0.35); // 扑到玩家脚前
            n.group.visible = true;
          }
          emit("zju-horror-interior-dim", { on: false });
          emit("zju-horror-jumpscare", { context: "dorm", intensity: 0.95, sanityCost: -10, customMessage: "镜子里的那张脸，就贴在你背后。" });
        }
      }
      for (const n of npcs) if (n.group.visible) n.update(t);
      for (const a of animators) a(t);
      for (const p of pickups) {
        if (p.taken) continue;
        p.glow.rotation.y = t * 1.4;
        p.glow.position.y = p.position.y + Math.sin(t * 2.2 + p.position.x) * 0.08;
      }
      for (const s of storyTriggers) {
        if (s.triggered) continue;
        s.glow.rotation.y = t * 0.9;
        s.glow.position.y = s.position.y + Math.sin(t * 1.8 + s.position.x) * 0.1;
      }
    };
    const dispose = (): void => {
      for (const n of npcs) n.dispose();
      for (const d of reflectorDisposers) d();
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      root.clear();
    };
    return { root, colliders, bounds, update, floorHeightAt, pickups, storyTriggers, doors, spawn, dispose };
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

    // Story triggers: first one visible, rest hidden until previous triggered
    addStoryTrigger("library_intro", 0, 0.7, 3.5);    // near the reading table
    addStoryTrigger("library_sound", 0, 0.7, -3.0);   // near the spiral staircase base
    // Hide all triggers after the first
    for (let i = 1; i < storyTriggers.length; i++) {
      storyTriggers[i].glow.visible = false;
    }

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

    // ── 地下仓库隔间（locked door, novel: 医学院地下二层）──
    const medDivider = new RoomDivider({
      startX: -halfW + 0.3, startZ: -halfL + 5.2, endX: halfW - 0.3, endZ: -halfL + 5.2,
      wallHeight: WALL_H,
      thickness: 0.2,
      color: palette.wall,
      door: { position: 0.5, width: 1.0, height: 2.2, keyItemId: "key_card", label: "地下仓库（需要门禁卡）" },
    });
    root.add(medDivider.group);
    colliders.push(...medDivider.wallColliders);
    if (medDivider.door) {
      doors.push(medDivider.door);
      colliders.push(medDivider.door.closedCollider);
    }
    // 隔间内：不锈钢停尸柜 + 解剖台(novel: 小剧场临时停尸间/人体解剖学)
    addBox(1.2, 0.5, 2.0, 1.5, 0.35, -halfL + 6.6, metalMat);
    addBox(1.2, 0.5, 2.0, -1.5, 0.35, -halfL + 6.6, metalMat);
    addBox(2.0, 0.85, 0.9, 0, 0.55, -halfL + 6.3, metalMat); // 解剖台
    addBox(1.9, 0.06, 0.85, 0, 1.0, -halfL + 6.3, stdMat(0xb7bcc0, 0.5, 0.2), false); // 台面
    // 盖着白布的推床(novel: 走廊尽头一寸一寸经过的旧病床)
    addBox(1.0, 0.55, 2.1, halfW - 1.6, 0.35, 0.2, metalMat);
    addBox(1.05, 0.2, 2.0, halfW - 1.6, 0.72, 0.2, stdMat(0xcfd2d0, 0.95), false); // 白布隆起
    // 幽绿应急灯(novel: 应急灯发出幽幽的绿光)——墙上一盏 + 环境点光
    addBox(0.28, 0.14, 0.08, -halfW + 0.35, 2.5, 0, stdMat(0x1a2a1e), false);
    const emGlow = trackMat(new THREE.MeshBasicMaterial({ color: 0x2bff7a }));
    addBox(0.2, 0.08, 0.03, -halfW + 0.4, 2.5, 0, emGlow, false);
    const greenLight = new THREE.PointLight(0x36ff86, 0.65, 9, 2);
    greenLight.position.set(-halfW + 1.0, 2.4, 0);
    root.add(greenLight);
    // 应急灯幽幽明灭 + 偶尔一次骤暗(novel: 幽幽的绿光)
    animators.push((t) => {
      greenLight.intensity = 0.5 + Math.abs(Math.sin(t * 1.7)) * 0.25 + (Math.sin(t * 37) > 0.92 ? -0.35 : 0);
    });
    // 红点:医学院入口剧情(novel: medical_entry)
    addStoryTrigger("medical_entry", -1.2, 0.7, 1.5);
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
    // ── 镜子(右墙中前段):真·镜面反射。玩家在镜中看见站在身后的红眼鬼,
    //    转身即与鬼面对面(见下方 npc 定位 + finalize 的 mirrorScare)。 ──
    const mirrorZ = -1.2;
    addBox(0.09, 1.55, 0.95, halfW - 0.2, 1.45, mirrorZ, woodMat, false); // 镜框
    if (typeof document !== "undefined") {
      const mirror = new Reflector(track(new THREE.PlaneGeometry(0.74, 1.32)), {
        textureWidth: 512,
        textureHeight: 512,
        color: 0x6f7d88,
        clipBias: 0.003,
      });
      mirror.position.set(halfW - 0.27, 1.45, mirrorZ);
      mirror.rotation.y = -Math.PI / 2; // 镜面法线朝 -X(面向房间内)
      root.add(mirror);
      // Reflector 自带 render target,需在 dispose 时释放。
      animators.push(() => {});
      const rdispose = () => mirror.dispose();
      reflectorDisposers.push(rdispose);
    } else {
      // 非 DOM(Node 测试)环境:退化为反光盒子。
      const glass = trackMat(new THREE.MeshStandardMaterial({ color: 0x9fb0bd, roughness: 0.12, metalness: 0.85 }));
      addBox(0.02, 1.32, 0.74, halfW - 0.27, 1.45, mirrorZ, glass, false);
    }

    // ── 走廊隔断 + 门（宿舍后段分隔出走廊/卫生间区域）──
    const dormDivider = new RoomDivider({
      startX: -halfW + 0.3, startZ: -halfL + 5.5, endX: halfW - 0.3, endZ: -halfL + 5.5,
      wallHeight: WALL_H,
      thickness: 0.2,
      color: palette.wall,
      door: { position: 0.25, width: 1.0, height: 2.2, label: "卫生间门" },
    });
    root.add(dormDivider.group);
    colliders.push(...dormDivider.wallColliders);
    if (dormDivider.door) {
      doors.push(dormDivider.door);
    }
    // 隔断后面：一个小卫生间（洗手台 + 蹲位示意）
    addBox(0.6, 0.8, 0.4, 0, 0.4, -halfL + 6.7, whiteMat);
    addBox(0.7, 1.8, 0.06, 1.6, 0.9, -halfL + 6.8, fabricMat, false);
    // 红点就在镜子面前:走到这里的一刻,鬼在镜中现形(见 finalize 的 mirrorScare)。
    addStoryTrigger("dorm_forum", halfW - 1.6, 0.6, -1.2);
  } else {
    // ── 小剧场/大厅布局：舞台 + 观众席 + 后台门 ──
    const stageY = 0.5;
    const stageZ = -halfL + 3.5;
    // 舞台平台
    addBox(ROOM_W - 1.5, stageY, 3.5, 0, stageY / 2, stageZ, woodMat);
    // 舞台幕布(红绒布柱)
    const curtainMat = stdMat(0x7b2229, 0.7);
    for (const sx of [-2.8, -1.4, 0, 1.4, 2.8]) {
      addBox(0.25, WALL_H - stageY, 0.3, sx, stageY + (WALL_H - stageY) / 2, stageZ + 1.8, curtainMat, false);
    }
    // 观众席（几排木长凳）+ 每个座位一根红绳,绳头拖地、汇向舞台中央(novel)
    const ropeMat = stdMat(0x7d1518, 0.75);
    for (let row = 0; row < 3; row++) {
      const rz = stageZ + 2.5 + row * 1.8;
      addBox(4.5, 0.12, 0.4, 0, 0.06, rz, woodMat, false);
      addBox(4.5, 0.45, 0.06, 0, 0.28, rz, woodMat, false); // 靠背
      colliders.push({ minX: -2.3, maxX: 2.3, minZ: rz - 0.3, maxZ: rz + 0.3 });
      // 每排几根红绳:座位上一小段 + 沿地面拖向舞台中心的细线
      for (const sx of [-1.6, -0.5, 0.6, 1.7]) {
        addBox(0.03, 0.16, 0.03, sx, 0.2, rz, ropeMat, false); // 座位上的绳结
        const midZ = (rz + stageZ) / 2;
        const len = rz - stageZ;
        const rope = new THREE.Mesh(track(new THREE.BoxGeometry(0.02, 0.01, len)), ropeMat);
        rope.position.set(sx * (1 - (rz - stageZ) * 0.06), 0.015, midZ); // 略微向中央收拢
        rope.rotation.y = Math.atan2(-sx, len) * 0.5;
        root.add(rope);
      }
    }
    // 舞台中心一束白光(novel: 舞台灯一盏盏熄灭,只剩中心一束白光)
    const spot = new THREE.SpotLight(0xf3f0e8, 3.2, 14, Math.PI / 7, 0.55, 1.2);
    spot.position.set(0, WALL_H - 0.1, stageZ + 0.2);
    spot.target.position.set(0, 0, stageZ);
    root.add(spot);
    root.add(spot.target);
    // 聚光灯偶尔明灭,像一盏快熄灭的舞台灯
    animators.push((t) => {
      spot.intensity = 3.2 * (0.82 + 0.18 * Math.sin(t * 2.3)) * (Math.sin(t * 26) > 0.94 ? 0.35 : 1);
    });
    // 舞台中央的旧木椅(novel: 白秋被绑在旧木椅上)
    addBox(0.5, 0.06, 0.5, 0, stageY + 0.5, stageZ, woodMat, false);
    addBox(0.5, 0.6, 0.06, 0, stageY + 0.8, stageZ - 0.22, woodMat, false); // 椅背
    for (const cxx of [-0.2, 0.2]) for (const czz of [-0.2, 0.2]) addBox(0.05, 0.5, 0.05, cxx, stageY + 0.25, stageZ + czz, woodMat, false);
    // 走廊两侧柱
    for (const sx of [-1, 1]) {
      addBox(0.5, 3.2, 0.5, sx * (halfW - 1.2), 1.6, -1.0, accentMat);
      addBox(0.5, 3.2, 0.5, sx * (halfW - 1.2), 1.6, 3.0, accentMat);
    }

    // ── 后台隔断 + 门（novel: 幕布后的空间"有人站在后台"）──
    const hallDivider = new RoomDivider({
      startX: -halfW + 0.3, startZ: stageZ - 0.5, endX: halfW - 0.3, endZ: stageZ - 0.5,
      wallHeight: WALL_H,
      thickness: 0.2,
      color: palette.wall,
      door: { position: 0.6, width: 1.0, height: 2.2, label: "后台门" },
    });
    root.add(hallDivider.group);
    colliders.push(...hallDivider.wallColliders);
    if (hallDivider.door) {
      doors.push(hallDivider.door);
      colliders.push(hallDivider.door.closedCollider);
    }
    // 后台：化妆台 + 道具箱
    addBox(1.6, 0.02, 0.9, 0, stageY + 0.01, -halfL + 1.2, fabricMat, false);
    addBox(0.9, 0.7, 0.5, -1.8, stageY + 0.35, -halfL + 0.9, woodMat);

    // Story triggers for theater indoor scenes
    addStoryTrigger("final_plan", 0, stageY + 0.7, stageZ + 1.2);
  }

  // Deep horror figure (hidden until the player walks in / approaches the mirror).
  const npc = buildCharacter({
    bodyColor: kind === "medical" ? 0xaeb4b8 : 0x14181e,
    skinColor: kind === "medical" ? 0xcdc7bb : 0xb9a894,
  });
  let revealNear: { x: number; z: number; r: number } | undefined;
  let mirrorScare: { x: number; z: number } | undefined;
  if (kind === "dorm") {
    // 红眼鬼站在玩家【身后】,面向镜子/玩家:走到镜前红点时才现形——
    // 此刻只能在镜中看到它;转身即与它面对面(jumpscare)。
    npc.group.position.set(halfW - 3.4, 0, -1.2);
    npc.group.rotation.y = Math.PI / 2; // 面向 +X(镜子方向)
    revealNear = { x: halfW - 1.6, z: -1.2, r: 1.35 };
    mirrorScare = { x: halfW - 1.6, z: -1.2 };
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

  return finalize(bounds, spawn, () => 0, { revealZ, revealFloor2: false, revealNear, mirrorScare });
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

  // Turnstile gate at the entrance (+Z) — posts are visual only, not solid.
  const gateZ = halfL - 2.2;
  for (const sx of [-1.3, 0, 1.3]) addBox(0.4, 1.0, 0.4, sx, 0.5, gateZ, metalMat, false);
  for (const sx of [-0.65, 0.65]) addBox(0.06, 0.1, 0.9, sx, 0.95, gateZ, whiteMat, false);
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
  // Spawn in clear space between the entrance and the reading table.
  const spawn = new THREE.Vector3(1.8, 1.6, 6.0);

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
