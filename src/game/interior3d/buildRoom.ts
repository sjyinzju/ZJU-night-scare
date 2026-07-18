import * as THREE from "three";
import { buildCharacter, type CharacterHandle } from "./buildCharacter";
import { DoorComponent } from "./DoorComponent";
import { buildStraightStairs, buildLStairs } from "./StaircaseBuilder";
import { RoomDivider } from "./RoomDivider";
import { getInteriorStoryItems, getInteriorStoryTriggers, getStoryItemName } from "../storyEngine";

/** Room archetypes with distinct furniture layouts. */
export type RoomKind = "library" | "medical" | "dorm" | "hall";

/** Axis-aligned bounding box on the floor plane (XZ). Used for collision. */
export interface AABB {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  activeSceneIds?: string[];
  /** Optional room-local live state, used by the medical-college door only. */
  isActive?: () => boolean;
}

/** A glowing, collectable item on the floor. */
export interface Pickup {
  id: string;
  itemId: string;
  name: string;
  activeSceneIds?: string[];
  glow: THREE.Object3D;
  position: THREE.Vector3;
  radius: number;
  taken: boolean;
}

/** A red-glowing story-trigger zone inside the 3D interior. Walk in → text popup. */
export interface StoryTrigger {
  id: string;
  sceneId: string;
  action: "story" | "exit";
  activeSceneIds: string[];
  glow: THREE.Object3D;
  position: THREE.Vector3;
  radius: number;
  triggered: boolean;
}

export interface InteriorGuideNode {
  id: string;
  x: number;
  z: number;
  links: string[];
}

export interface InteriorPhaseObject {
  object: THREE.Object3D;
  activeSceneIds: string[];
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
  /** Walkable guide graph for floor routes that should avoid furniture. */
  guideNodes: InteriorGuideNode[];
  /** Visual objects controlled by the current story phase. */
  phaseObjects: InteriorPhaseObject[];
  /** NPC character groups — visibility controlled by story engine via activeSceneIds. */
  npcGroups: THREE.Group[];
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
  // Library: warm red-brick tone, dimmed for horror atmosphere.
  library: { floor: 0x1f1a18, wall: 0x4a3035, ceiling: 0x161012, accent: 0xb87060, wood: 0x6b4b2e },
  medical: { floor: 0x20262a, wall: 0x2b333a, ceiling: 0x12171b, accent: 0x6fa6ad, wood: 0x4a4038 },
  dorm: { floor: 0x2b333d, wall: 0x3b3a3f, ceiling: 0x17161a, accent: 0x5f7fa8, wood: 0x9a744a },
  hall: { floor: 0x22242a, wall: 0x2c2f37, ceiling: 0x14161b, accent: 0x8a8fa0, wood: 0x5a4a38 },
};

const WALL_T = 0.28;

export function buildRoom(kind: RoomKind): RoomBuildResult {
  const root = new THREE.Group();
  root.name = `room-${kind}`;

  const palette = PALETTES[kind];
  const colliders: AABB[] = [];
  const npcs: CharacterHandle[] = [];
  const pickups: Pickup[] = [];
  const storyTriggers: StoryTrigger[] = [];
  const doors: DoorComponent[] = [];
  const guideNodes: InteriorGuideNode[] = [];
  const phaseObjects: InteriorPhaseObject[] = [];

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
  // Books placed only on shelves 2 & 3 from the top (indices 1 & 2),
  // scaled up for readability, sitting on the shelf front face.
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
    // Shelf Y positions (4 shelves): 0.35, 0.95, 1.55, 2.15 — use only [1] & [2].
    const shelfYs = [0.35, 0.95, 1.55, 2.15];
    for (const si of [1, 2]) {
      const y = shelfYs[si];
      const usableW = w - 0.16; // inset from frame edges
      const bookW = 0.13;       // wider, readable book spine
      const count = Math.floor(usableW / (bookW + 0.02));
      for (let b = 0; b < count; b++) {
        const bh = 0.44 + ((b * 7) % 6) * 0.025; // taller books
        const bm = stdMat(spineColors[(b + si) % spineColors.length], 0.9);
        const book = new THREE.Mesh(track(new THREE.BoxGeometry(bookW, bh, 0.24)), bm);
        // Place on the shelf front face (frame depth 0.4 → front at z=0.2, inset books to z=0.22).
        book.position.set(-usableW / 2 + bookW / 2 + b * (bookW + 0.02), y + bh / 2, 0.22);
        g.add(book);
      }
    }
    const cw = Math.abs(Math.cos(rot)) * w + Math.abs(Math.sin(rot)) * 0.4;
    const cd = Math.abs(Math.sin(rot)) * w + Math.abs(Math.cos(rot)) * 0.4;
    colliders.push({ minX: cx - cw / 2, maxX: cx + cw / 2, minZ: cz - cd / 2, maxZ: cz + cd / 2 });
  };

  // A glowing collectable item (floats + bobs, auto-collected on approach).
  const addPickup = (
    itemId: string,
    name: string,
    x: number,
    y: number,
    z: number,
    color: number,
    activeSceneIds?: string[],
  ): void => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    root.add(g);
    if (itemId === "flashlight") {
      const bodyMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x2b3138, roughness: 0.42, metalness: 0.28 }));
      const rimMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xc9b276, roughness: 0.28, metalness: 0.48 }));
      const lensMat = trackMat(
        new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color), emissiveIntensity: 1.4, roughness: 0.2 }),
      );
      const body = new THREE.Mesh(track(new THREE.CylinderGeometry(0.075, 0.09, 0.48, 16)), bodyMat);
      body.rotation.z = Math.PI / 2;
      body.castShadow = true;
      g.add(body);
      const head = new THREE.Mesh(track(new THREE.CylinderGeometry(0.13, 0.1, 0.18, 18)), rimMat);
      head.rotation.z = Math.PI / 2;
      head.position.x = 0.31;
      head.castShadow = true;
      g.add(head);
      const lens = new THREE.Mesh(track(new THREE.CircleGeometry(0.095, 18)), lensMat);
      lens.rotation.y = Math.PI / 2;
      lens.position.x = 0.405;
      g.add(lens);
    } else {
      const coreMat = trackMat(
        new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color), emissiveIntensity: 1.6, roughness: 0.35 }),
      );
      const core = new THREE.Mesh(track(new THREE.IcosahedronGeometry(0.12, 0)), coreMat);
      g.add(core);
    }
    const haloMat = trackMat(
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
    );
    const halo = new THREE.Mesh(track(new THREE.SphereGeometry(0.3, 12, 12)), haloMat);
    g.add(halo);
    // Flashlight emits a strong red guide light so the player can spot it from across the room.
    const guideColor = itemId === "flashlight" ? 0xcc3333 : color;
    const guideIntensity = itemId === "flashlight" ? 3.5 : 1.1;
    const guideRange = itemId === "flashlight" ? 7.0 : 3.2;
    const light = new THREE.PointLight(guideColor, guideIntensity, guideRange, 2);
    g.add(light);
    pickups.push({
      id: `${itemId}-${pickups.length}`,
      itemId,
      name,
      activeSceneIds,
      glow: g,
      position: new THREE.Vector3(x, y, z),
      radius: 0.9,
      taken: false,
    });
  };

  // A red glowing story-trigger zone. Player walks in → text popup in the 3D interior.
  const addStoryTrigger = (
    sceneId: string,
    x: number,
    y: number,
    z: number,
    action: "story" | "exit" = "story",
    activeSceneIds: string[] = [sceneId],
    radius = 1.2,
  ): void => {
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
      action,
      activeSceneIds,
      glow: g,
      position: new THREE.Vector3(x, y, z),
      radius,
      triggered: false,
    });
  };

  // Chinese-style ceiling lantern: red barrel body, brass rings, cord to ceiling.
  const addCeilingLantern = (x: number, z: number, ceilingY: number): void => {
    const g = new THREE.Group();
    g.position.set(x, ceilingY - 0.4, z);
    root.add(g);
    const bodyColor = 0xb8443a;
    const mat = trackMat(new THREE.MeshStandardMaterial({ color: bodyColor, emissive: new THREE.Color(bodyColor), emissiveIntensity: 1.2, roughness: 0.35 }));
    const body = new THREE.Mesh(track(new THREE.CylinderGeometry(0.16, 0.2, 0.45, 12)), mat);
    g.add(body);
    const ringMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x8a6d40, roughness: 0.35, metalness: 0.55 }));
    const topRing = new THREE.Mesh(track(new THREE.TorusGeometry(0.16, 0.025, 8, 12)), ringMat);
    topRing.position.y = 0.24;
    g.add(topRing);
    const botRing = new THREE.Mesh(track(new THREE.TorusGeometry(0.16, 0.025, 8, 12)), ringMat);
    botRing.position.y = -0.24;
    g.add(botRing);
    const cord = new THREE.Mesh(track(new THREE.CylinderGeometry(0.012, 0.012, 0.38, 6)), trackMat(new THREE.MeshBasicMaterial({ color: 0x2a2018 })));
    cord.position.y = 0.4;
    g.add(cord);
    const light = new THREE.PointLight(bodyColor, 0.65, 5.0, 2);
    light.position.y = 0;
    g.add(light);
  };

  // Shared finalizer (hoisted). Closes over root/npcs/pickups/storyTriggers/geometries/materials.
  function finalize(
    bounds: AABB,
    spawn: THREE.Vector3,
    floorHeightAt: (x: number, z: number) => number,
  ): RoomBuildResult {
    // NPC visibility is now controlled by Interior3D.syncStoryPhase() via story engine.
    // NPCs start hidden and are shown only when currentSceneId matches reveal scene IDs.
    const update = (t: number, _playerPos: THREE.Vector3): void => {
      for (const n of npcs) if (n.group.visible) n.update(t);
      for (const p of pickups) {
        if (p.taken || !p.glow.visible) continue;
        p.glow.rotation.y = t * 1.4;
        p.glow.position.y = p.position.y + Math.sin(t * 2.2 + p.position.x) * 0.08;
      }
      for (const s of storyTriggers) {
        if (s.triggered || !s.glow.visible) continue;
        s.glow.rotation.y = t * 0.9;
        s.glow.position.y = s.position.y + Math.sin(t * 1.8 + s.position.x) * 0.1;
      }
    };
    const dispose = (): void => {
      for (const n of npcs) n.dispose();
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      root.clear();
    };
    const npcGroups = npcs.map((n) => n.group);
    return { root, colliders, bounds, update, floorHeightAt, pickups, storyTriggers, doors, guideNodes, phaseObjects, npcGroups, spawn, dispose };
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
      phaseObjects,
      guideNodes,
    });
    const npc = buildCharacter({ bodyColor: 0x161b22, skinColor: 0xb7c2c9 });
    npc.group.position.set(built.npc.x, built.npc.y, built.npc.z);
    npc.group.rotation.y = built.npc.ry;
    npc.group.visible = false;
    root.add(npc.group);
    npcs.push(npc);

    const librarySceneItems = getInteriorStoryItems("library");
    librarySceneItems.forEach((it, i) => {
      const p = it.placement === "flashlight"
        ? built.flashlightSpots[Math.floor(Math.random() * built.flashlightSpots.length)] ?? built.flashlightSpots[0]
        : built.pickupSpots[i] ?? built.pickupSpots[0];
      const pointY = (p as unknown as { y?: number }).y;
      const y = typeof pointY === "number" ? pointY : 0.72;
      addPickup(it.itemId, getStoryItemName(it.itemId), p.x, y, p.z, it.color ?? (i === 0 ? 0x8fd0ff : 0xffd27a), it.activeSceneIds);
    });

    getInteriorStoryTriggers("library").forEach((trigger) => {
      const p = built.triggers[trigger.position as keyof typeof built.triggers];
      if (p) addStoryTrigger(trigger.sceneId, p.x, 0.7, p.z, trigger.action, trigger.activeSceneIds, trigger.radius);
    });
    // Hide all triggers after the first
    for (let i = 1; i < storyTriggers.length; i++) {
      storyTriggers[i].glow.visible = false;
    }

    return finalize(built.bounds, built.spawn, built.floorHeightAt);
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
  let flatFloorHeightAt = (_x: number, _z: number): number => 0;

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
      alignVisualToSegment: true,
      // A 1 m opening left only ~0.24 m of centre-line tolerance after the
      // collider padding and player radius were applied. Keep this medical
      // doorway comfortably walkable without changing dividers in other rooms.
      door: {
        position: 0.5,
        width: 1.6,
        height: 2.2,
        keyItemId: "key_card",
        initiallyLocked: false,
        label: "地下仓库门",
        pivotAtLeftJamb: true,
      },
    });
    root.add(medDivider.group);
    colliders.push(...medDivider.wallColliders);
    if (medDivider.door) {
      doors.push(medDivider.door);
      const door = medDivider.door;
      door.closedCollider.isActive = () => !door.isOpen;
      colliders.push(door.closedCollider);
    }
    // 隔间内保留两侧储物柜；中央通道必须直达地下仓库门。
    addBox(1.2, 0.5, 2.0, 1.5, 0.35, -halfL + 6.6, metalMat);
    addBox(1.2, 0.5, 2.0, -1.5, 0.35, -halfL + 6.6, metalMat);

    // ── 剧情触发区（医学院内景：鬼现形 + 苏婉照片）──
    // 触发器碰撞区保持在地面，视觉改为天花板中式灯笼（不再悬空红球）
    const medTriggerCountBefore = storyTriggers.length;
    getInteriorStoryTriggers("medical").forEach((trigger) => {
      if (trigger.position === "ghost") {
        addStoryTrigger(trigger.sceneId, 0, 0.7, -halfL + 3.4, trigger.action, trigger.activeSceneIds, trigger.radius);
        addCeilingLantern(0, -halfL + 3.4, WALL_H);
      } else if (trigger.position === "stand") {
        addStoryTrigger(trigger.sceneId, 0, 0.7, 1.0, trigger.action, trigger.activeSceneIds, trigger.radius);
        addCeilingLantern(0, 1.0, WALL_H);
      }
    });
    // 隐藏医疗室触发器的浮空红球视觉（保留碰撞检测），用天花板灯笼替代
    for (let i = medTriggerCountBefore; i < storyTriggers.length; i++) {
      storyTriggers[i].glow.visible = false;
    }
    // 检查床上方天花板灯笼
    addCeilingLantern(-halfW + 1.3, -3.5, WALL_H);
    addCeilingLantern(-halfW + 1.3, 0.1, WALL_H);
    addCeilingLantern(-halfW + 1.3, 3.7, WALL_H);
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

    // ── 走廊隔断 + 门（宿舍后段分隔出走廊/卫生间区域）──
    const dormDivider = new RoomDivider({
      startX: -halfW + 0.3, startZ: -halfL + 5.5, endX: halfW - 0.3, endZ: -halfL + 5.5,
      wallHeight: WALL_H,
      thickness: 0.2,
      color: palette.wall,
      alignVisualToSegment: true,
      door: { position: 0.25, width: 1.6, height: 2.2, label: "宿舍门", pivotAtLeftJamb: true },
    });
    root.add(dormDivider.group);
    colliders.push(...dormDivider.wallColliders);
    if (dormDivider.door) {
      doors.push(dormDivider.door);
      const door = dormDivider.door;
      door.closedCollider.isActive = () => !door.isOpen;
      colliders.push(door.closedCollider);
    }
    guideNodes.push(
      { id: "dorm-entry", x: 0, z: 5.6, links: ["dorm-door-front"] },
      { id: "dorm-door-front", x: -2.0, z: -1.4, links: ["dorm-entry", "dorm-door-back"] },
      { id: "dorm-door-back", x: -2.0, z: -2.6, links: ["dorm-door-front", "dorm-forum"] },
      { id: "dorm-forum", x: -2.0, z: -3.6, links: ["dorm-door-back"] },
    );
    // 隔断后面：一个小卫生间（洗手台 + 蹲位示意）
    addBox(0.6, 0.8, 0.4, 0, 0.4, -halfL + 6.7, whiteMat);
    addBox(0.7, 1.8, 0.06, 1.6, 0.9, -halfL + 6.8, fabricMat, false);
    getInteriorStoryTriggers("dorm").forEach((trigger) => {
      if (trigger.position === "forum") {
        // Stand in front of the loft desk instead of inside its collision box.
        addStoryTrigger(trigger.sceneId, -2.0, 0.85, -3.6, trigger.action, trigger.activeSceneIds, trigger.radius);
      }
    });
  } else {
    // ── 小剧场/大厅布局：舞台 + 观众席 + 后台门 ──
    const stageY = 0.5;
    const stageZ = -halfL + 3.5;
    // 舞台平台
    addBox(ROOM_W - 1.5, stageY, 3.5, 0, stageY / 2, stageZ, woodMat, false);
    flatFloorHeightAt = (x: number, z: number): number =>
      Math.abs(x) <= (ROOM_W - 1.5) / 2 && Math.abs(z - stageZ) <= 3.5 / 2 ? stageY : 0;
    // 舞台幕布(红绒布柱)
    const curtainMat = stdMat(0x7b2229, 0.7);
    for (const sx of [-2.8, -1.4, 0, 1.4, 2.8]) {
      addBox(0.25, WALL_H - stageY, 0.3, sx, stageY + (WALL_H - stageY) / 2, stageZ + 1.8, curtainMat, false);
    }
    // 观众席（几排木长凳）
    for (let row = 0; row < 3; row++) {
      const rz = stageZ + 2.5 + row * 1.8;
      addBox(4.5, 0.12, 0.4, 0, 0.06, rz, woodMat, false);
      addBox(4.5, 0.45, 0.06, 0, 0.28, rz, woodMat, false); // 靠背
      colliders.push({ minX: -2.3, maxX: 2.3, minZ: rz - 0.3, maxZ: rz + 0.3 });
    }
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
      alignVisualToSegment: true,
      door: { position: 0.6, width: 1.6, height: 2.2, label: "后台门", pivotAtLeftJamb: true },
    });
    root.add(hallDivider.group);
    colliders.push(...hallDivider.wallColliders);
    if (hallDivider.door) {
      doors.push(hallDivider.door);
      const door = hallDivider.door;
      door.closedCollider.isActive = () => !door.isOpen;
      colliders.push(door.closedCollider);
    }
    guideNodes.push(
      { id: "hall-entry", x: 0, z: 5.8, links: ["hall-right-aisle"] },
      { id: "hall-right-aisle", x: 3.7, z: 4.0, links: ["hall-entry", "hall-right-mid"] },
      { id: "hall-right-mid", x: 3.7, z: 1.5, links: ["hall-right-aisle", "hall-right-front"] },
      { id: "hall-right-front", x: 3.7, z: -1.7, links: ["hall-right-mid", "hall-stage-edge"] },
      { id: "hall-stage-edge", x: 3.3, z: -2.2, links: ["hall-right-front", "hall-stage-clue"] },
      { id: "hall-stage-clue", x: 0, z: stageZ + 1.2, links: ["hall-stage-edge"] },
    );
    // 后台：化妆台 + 道具箱
    addBox(1.6, 0.02, 0.9, 0, stageY + 0.01, -halfL + 1.2, fabricMat, false);
    addBox(0.9, 0.7, 0.5, -1.8, stageY + 0.35, -halfL + 0.9, woodMat);

    getInteriorStoryTriggers("hall").forEach((trigger) => {
      if (trigger.position === "stage") {
        addStoryTrigger(trigger.sceneId, 0, stageY + 0.7, stageZ + 1.2, trigger.action, trigger.activeSceneIds, trigger.radius);
      }
    });
  }

  // NPC visibility is now controlled by Interior3D.syncStoryPhase() via story engine.
  // See INTERIOR_NPC_REVEAL_SCENE_IDS in storyEngine.ts for per-room reveal scenes.
  const npc = buildCharacter({
    bodyColor: kind === "medical" ? 0xaeb4b8 : 0x14181e,
    skinColor: kind === "medical" ? 0xcdc7bb : 0xb9a894,
  });
  if (kind === "dorm") {
    npc.group.position.set(halfW - 1.35, 0, -1.2);
    npc.group.rotation.y = -Math.PI / 2;
  } else {
    const npcZ = -halfL + 1.6;
    npc.group.position.set(0.2, 0, npcZ);
    npc.group.rotation.y = 0;
    const npcCollider: AABB = { minX: -0.5, maxX: 0.7, minZ: npcZ - 0.5, maxZ: npcZ + 0.5 };
    // The medical NPC starts hidden. Its collider must not remain as an
    // invisible obstacle before the corresponding story phase reveals it.
    if (kind === "medical") npcCollider.isActive = () => npc.group.visible;
    colliders.push(npcCollider);
  }
  npc.group.visible = false;
  root.add(npc.group);
  npcs.push(npc);

  // Pickups on open, reachable floor (avoid furniture footprints per room).
  const items = getInteriorStoryItems(kind);
  const spotsByKind: Record<string, { x: number; z: number }[]> = {
    medical: [{ x: -1.4, z: -1.2 }],
    dorm: [{ x: 0, z: 2.6 }, { x: 1.8, z: 1.4 }],
    hall: [{ x: -2.4, z: 0.2 }, { x: 2.4, z: 0.2 }],
  };
  const spots = spotsByKind[kind] ?? spotsByKind.hall;
  items.forEach((it, i) => {
    const s = spots[i] ?? spots[0];
    addPickup(it.itemId, getStoryItemName(it.itemId), s.x, 0.75, s.z, it.color ?? (i === 0 ? 0xffe08a : 0x8fd0ff), it.activeSceneIds);
  });

  const bounds: AABB = {
    minX: -halfW + WALL_T,
    maxX: halfW - WALL_T,
    minZ: -halfL + WALL_T,
    maxZ: halfL - WALL_T,
  };
  const spawn = new THREE.Vector3(0, 1.6, halfL - 1.2);

  return finalize(bounds, spawn, flatFloorHeightAt);
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
  guideNodes: InteriorGuideNode[];
  phaseObjects: InteriorPhaseObject[];
}

interface LibResult {
  bounds: AABB;
  spawn: THREE.Vector3;
  floorHeightAt: (x: number, z: number) => number;
  npc: { x: number; y: number; z: number; ry: number };
  pickupSpots: { x: number; y: number; z: number }[];
  flashlightSpots: { x: number; z: number }[];
  triggers: {
    intro: { x: number; z: number };
    sound: { x: number; z: number };
    exit: { x: number; z: number };
  };
}

function buildLibrary(ctx: LibCtx): LibResult {
  const {
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
    root,
    colliders,
    guideNodes,
    phaseObjects,
  } = ctx;
  const W = 13.5;
  const L = 18;
  const WALL_H = 4.2;
  const halfW = W / 2;
  const halfL = L / 2;
  const floorY = 0.018;

  const woodMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x6b4b2e, roughness: 0.82 }));
  const darkWoodMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x3d2c22, roughness: 0.9 }));
  const seatMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x334257, roughness: 0.94 }));
  const brassMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xa77c3f, roughness: 0.48, metalness: 0.35 }));
  const tileLineMat = trackMat(new THREE.MeshBasicMaterial({ color: 0x50606b, transparent: true, opacity: 0.22 }));
  const pathMat = trackMat(new THREE.MeshBasicMaterial({ color: 0x793733, transparent: true, opacity: 0.16 }));

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

  for (let x = -6; x <= 6; x += 1.5) addBox(0.018, 0.01, L - 0.5, x, floorY, 0, tileLineMat, false);
  for (let z = -8.25; z <= 8.25; z += 1.5) addBox(W - 0.5, 0.01, 0.018, 0, floorY, z, tileLineMat, false);

  const addChair = (x: number, z: number, ry = 0): void => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    root.add(g);
    const seat = new THREE.Mesh(track(new THREE.BoxGeometry(0.42, 0.08, 0.42)), seatMat);
    seat.position.y = 0.45;
    seat.castShadow = true;
    g.add(seat);
    const back = new THREE.Mesh(track(new THREE.BoxGeometry(0.42, 0.48, 0.06)), seatMat);
    back.position.set(0, 0.72, 0.2);
    back.castShadow = true;
    g.add(back);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(track(new THREE.BoxGeometry(0.055, 0.45, 0.055)), metalMat);
      leg.position.set(sx * 0.16, 0.225, sz * 0.16);
      g.add(leg);
    }
  };

  const addStudyTable = (x: number, z: number, w = 1.25, d = 0.78): void => {
    addBox(w, 0.08, d, x, 0.76, z, woodMat, false);
    addBox(w - 0.16, 0.035, 0.08, x, 0.82, z, accentMat, false);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      addBox(0.075, 0.72, 0.075, x + sx * (w / 2 - 0.14), 0.36, z + sz * (d / 2 - 0.12), metalMat, false);
    }
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
    addChair(x - w * 0.32, z + d * 0.9, Math.PI);
    addChair(x + w * 0.32, z + d * 0.9, Math.PI);
    addChair(x - w * 0.32, z - d * 0.9, 0);
    addChair(x + w * 0.32, z - d * 0.9, 0);
  };

  const addRouteCarpet = (x: number, z: number, w: number, d: number): void => {
    addBox(w, 0.012, d, x, 0.026, z, pathMat, false);
  };

  addRouteCarpet(-3.0, -2.25, 4.8, 1.0);
  addRouteCarpet(0.3, -3.25, 4.2, 0.9);
  addStudyTable(-5.0, -5.95);
  addStudyTable(-5.0, -3.45);
  addStudyTable(1.0, -5.75);
  addStudyTable(4.25, -5.75);
  addStudyTable(1.0, -3.35);
  addStudyTable(4.25, -3.35);

  const introWallLeft = addBox(4.2, 3.7, 0.2, -4.65, 1.85, 0.45, wallMat);
  const introWallRight = addBox(6.1, 3.7, 0.2, 3.45, 1.85, 0.45, wallMat);
  // The real asset has a known gap around the intro gate on some exports.
  // Keep these two shell segments visible, while the gate itself comes only
  // from the GLB phase visual.
  introWallLeft.userData.keepWithAsset = true;
  introWallRight.userData.keepWithAsset = true;
  const storyGate = addBox(2.7, 2.45, 0.16, -0.8, 1.25, 0.45, whiteMat, false);
  phaseObjects.push({ object: storyGate, activeSceneIds: ["library_intro"] });
  colliders.push({ minX: -2.15, maxX: 0.55, minZ: 0.37, maxZ: 0.53, activeSceneIds: ["library_intro"] });
  addRouteCarpet(-0.9, 1.4, 1.25, 2.2);
  addRouteCarpet(1.7, 2.25, 5.2, 0.82);

  for (const [x, z] of [[2.0, 2.05], [2.0, 4.75], [2.0, 7.05], [5.15, 2.05], [5.15, 4.75], [5.15, 7.05]] as const) {
    addBookshelf(x, z, 1.65, Math.PI / 2);
    colliders.push({ minX: x - 0.42, maxX: x + 0.42, minZ: z - 0.88, maxZ: z + 0.88 });
  }
  addBox(3.6, 0.04, 0.8, 3.85, 0.04, 6.88, pathMat, false);

  addBox(2.2, 0.95, 0.48, -4.65, 0.48, 4.7, darkWoodMat);
  addBox(1.2, 1.7, 0.45, -5.2, 0.85, 6.35, metalMat);
  addBox(0.8, 0.08, 0.8, -3.65, 0.78, 6.1, accentMat, false);

  const gateZ = 7.35;
  const exitZ = 7.84;
  for (const sx of [-1.2, -0.6, 0, 0.6, 1.2]) addBox(0.08, 2.2, 0.08, sx, 1.1, gateZ, metalMat, false);
  addBox(2.7, 0.08, 0.08, 0, 0.25, gateZ, metalMat, false);
  addBox(2.7, 0.08, 0.08, 0, 2.05, gateZ, metalMat, false);
  addBox(0.08, 2.2, 0.08, -1.38, 1.1, gateZ, brassMat, false);
  addBox(0.08, 2.2, 0.08, 1.38, 1.1, gateZ, brassMat, false);

  guideNodes.push(
    { id: "spawn-left", x: -3.85, z: -2.35, links: ["left-aisle", "upper-cross"] },
    { id: "left-aisle", x: -3.2, z: -2.85, links: ["spawn-left", "upper-cross"] },
    { id: "upper-cross", x: -1.1, z: -2.85, links: ["spawn-left", "left-aisle", "right-entry", "passage-top"] },
    { id: "right-entry", x: 0.75, z: -2.35, links: ["upper-cross", "intro"] },
    { id: "intro", x: 2.25, z: -2.05, links: ["right-entry"] },
    { id: "passage-top", x: -0.85, z: 0.05, links: ["upper-cross", "passage-bottom"] },
    { id: "passage-bottom", x: -0.85, z: 2.2, links: ["passage-top", "shelf-entry", "gate-approach"] },
    { id: "shelf-entry", x: 5.0, z: 2.35, links: ["passage-bottom", "shelf-aisle"] },
    { id: "shelf-aisle", x: 5.0, z: 3.35, links: ["shelf-entry", "shelf-exit"] },
    { id: "shelf-exit", x: 5.0, z: 6.82, links: ["shelf-aisle", "gate-approach"] },
    { id: "gate-approach", x: 0.35, z: 6.85, links: ["passage-bottom", "shelf-exit", "gate"] },
    { id: "gate", x: 0.0, z: exitZ, links: ["gate-approach"] },
  );

  const bounds: AABB = { minX: -halfW + 0.3, maxX: halfW - 0.3, minZ: -halfL + 0.3, maxZ: halfL - 0.3 };
  const spawn = new THREE.Vector3(-3.85, 1.6, -2.35);
  const floorHeightAt = (): number => 0;

  return {
    bounds,
    spawn,
    floorHeightAt,
    npc: { x: -1.1, y: 0, z: -7.25, ry: Math.PI },
    pickupSpots: [
      { x: -5.55, y: 0.7, z: -1.15 },
      { x: 1.25, y: 0.7, z: 6.15 },
    ],
    flashlightSpots: [
      { x: -3.35, z: -1.45 },
      { x: -1.85, z: -1.55 },
      { x: -2.65, z: -0.95 },
    ],
    triggers: {
      intro: { x: 2.25, z: -2.05 },
      sound: { x: 5.0, z: 3.35 },
      exit: { x: 0.0, z: exitZ },
    },
  };
}
