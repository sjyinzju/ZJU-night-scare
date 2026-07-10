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

export interface RoomBuildResult {
  /** Group holding all room + furniture + NPC meshes. Add to the scene. */
  root: THREE.Group;
  /** Solid furniture / wall footprints the player must not pass through. */
  colliders: AABB[];
  /** Inner playable bounds (already inset from the walls). */
  bounds: AABB;
  /** Advances every NPC idle animation. `t` in seconds. */
  npcUpdate: (t: number) => void;
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
  if (/dorm|hostel|宿舍|寝/.test(key)) return "dorm";
  return "hall";
}

interface Palette {
  floor: number;
  wall: number;
  ceiling: number;
  accent: number;
}

const PALETTES: Record<RoomKind, Palette> = {
  library: { floor: 0x2a2018, wall: 0x342a20, ceiling: 0x171310, accent: 0x5a4632 },
  medical: { floor: 0x20262a, wall: 0x2b333a, ceiling: 0x12171b, accent: 0x3f6d74 },
  dorm: { floor: 0x241f28, wall: 0x2e2836, ceiling: 0x141019, accent: 0x51455f },
  hall: { floor: 0x22242a, wall: 0x2c2f37, ceiling: 0x14161b, accent: 0x454a58 },
};

// Room is a long-ish corridor room: width along X, length along Z.
const ROOM_W = 12;
const ROOM_L = 22;
const WALL_H = 3.4;
const WALL_T = 0.3;

export function buildRoom(kind: RoomKind): RoomBuildResult {
  const root = new THREE.Group();
  root.name = `room-${kind}`;

  const palette = PALETTES[kind];
  const colliders: AABB[] = [];
  const npcs: CharacterHandle[] = [];

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

  const stdMat = (color: number, rough = 0.9): THREE.MeshStandardMaterial =>
    trackMat(
      new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.04 })
    );

  const floorMat = stdMat(palette.floor, 0.95);
  const wallMat = stdMat(palette.wall);
  const ceilMat = stdMat(palette.ceiling);
  const accentMat = stdMat(palette.accent, 0.7);
  const metalMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x40454c,
      roughness: 0.4,
      metalness: 0.55,
    })
  );

  const halfW = ROOM_W / 2;
  const halfL = ROOM_L / 2;

  // ---- Shell: floor + ceiling ----
  const floorGeo = track(new THREE.PlaneGeometry(ROOM_W, ROOM_L));
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  root.add(floor);

  const ceil = new THREE.Mesh(track(new THREE.PlaneGeometry(ROOM_W, ROOM_L)), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = WALL_H;
  root.add(ceil);

  // ---- Walls (as boxes so they read as solid volumes) ----
  const addBox = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
    solid = true
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(track(new THREE.BoxGeometry(w, h, d)), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    if (solid) {
      colliders.push({
        minX: x - w / 2,
        maxX: x + w / 2,
        minZ: z - d / 2,
        maxZ: z + d / 2,
      });
    }
    return mesh;
  };

  // Back / front walls (perpendicular to Z).
  addBox(ROOM_W + WALL_T, WALL_H, WALL_T, 0, WALL_H / 2, -halfL, wallMat);
  addBox(ROOM_W + WALL_T, WALL_H, WALL_T, 0, WALL_H / 2, halfL, wallMat);
  // Side walls (perpendicular to X).
  addBox(WALL_T, WALL_H, ROOM_L + WALL_T, -halfW, WALL_H / 2, 0, wallMat);
  addBox(WALL_T, WALL_H, ROOM_L + WALL_T, halfW, WALL_H / 2, 0, wallMat);

  // ---- Columns + door frames along the corridor ----
  for (let i = -1; i <= 1; i++) {
    const z = i * 7;
    addBox(0.35, WALL_H, 0.35, -halfW + 0.9, WALL_H / 2, z, accentMat);
    addBox(0.35, WALL_H, 0.35, halfW - 0.9, WALL_H / 2, z, accentMat);
  }
  // A door frame at the far end (non-solid lintel + solid posts).
  addBox(0.25, WALL_H, 0.25, -1.1, WALL_H / 2, -halfL + 0.4, accentMat);
  addBox(0.25, WALL_H, 0.25, 1.1, WALL_H / 2, -halfL + 0.4, accentMat);
  addBox(2.6, 0.4, 0.25, 0, WALL_H - 0.2, -halfL + 0.4, accentMat, false);

  // ---- Furniture per archetype ----
  const furnitureBuilders: Record<RoomKind, () => void> = {
    library: () => {
      // Rows of tall bookshelves down both sides.
      for (let i = 0; i < 4; i++) {
        const z = -6 + i * 4;
        addBox(0.6, 2.6, 2.6, -halfW + 1.6, 1.3, z, accentMat);
        addBox(0.6, 2.6, 2.6, halfW - 1.6, 1.3, z, accentMat);
      }
      // A reading table with chairs in the centre.
      addBox(2.4, 0.12, 1.1, 0, 0.78, 4, accentMat);
      addBox(0.4, 0.8, 0.4, -0.9, 0.4, 4.7, wallMat);
      addBox(0.4, 0.8, 0.4, 0.9, 0.4, 3.3, wallMat);
    },
    medical: () => {
      // Hospital beds in a row.
      for (let i = 0; i < 3; i++) {
        const z = -5 + i * 5;
        addBox(1.0, 0.5, 2.1, -halfW + 1.6, 0.35, z, metalMat);
        addBox(1.0, 0.12, 2.0, -halfW + 1.6, 0.62, z, stdMat(0x9fb4b0, 0.8), false);
      }
      // Cabinets / trolleys on the other side.
      addBox(1.0, 1.4, 0.6, halfW - 1.4, 0.7, -3, metalMat);
      addBox(1.0, 1.4, 0.6, halfW - 1.4, 0.7, 3, metalMat);
      addBox(0.6, 0.9, 0.6, 0, 0.45, 6, metalMat);
    },
    dorm: () => {
      // Bunk beds along the walls.
      for (let i = 0; i < 3; i++) {
        const z = -5 + i * 5;
        addBox(1.1, 0.15, 2.0, -halfW + 1.4, 0.5, z, accentMat);
        addBox(1.1, 0.15, 2.0, -halfW + 1.4, 1.4, z, accentMat);
        addBox(1.1, 0.15, 2.0, halfW - 1.4, 0.5, z, accentMat);
      }
      // Wardrobes / lockers.
      addBox(0.7, 2.0, 0.7, halfW - 1.2, 1.0, 3, metalMat);
      addBox(0.7, 2.0, 0.7, halfW - 1.2, 1.0, 6.5, metalMat);
    },
    hall: () => {
      // Central benches + scattered pillars for a lobby feel.
      addBox(3.0, 0.5, 0.8, 0, 0.25, -3, accentMat);
      addBox(3.0, 0.5, 0.8, 0, 0.25, 3, accentMat);
      addBox(0.5, 1.1, 0.5, -3, 0.55, 6, metalMat);
      addBox(0.5, 1.1, 0.5, 3, 0.55, 6, metalMat);
    },
  };
  furnitureBuilders[kind]();

  // ---- NPC(s): at least one, standing in the room, back toward spawn ----
  const npc = buildCharacter({
    bodyColor: kind === "medical" ? 0xb7bcc0 : 0x1d2126,
    skinColor: kind === "medical" ? 0xcfcabf : 0xb9a894,
  });
  npc.group.position.set(0, 0, -halfL + 3);
  // Facing away from the entrance (which is at +Z) for the classic scare.
  npc.group.rotation.y = 0;
  root.add(npc.group);
  npcs.push(npc);
  // Its footprint blocks the player.
  colliders.push({ minX: -0.5, maxX: 0.5, minZ: -halfL + 2.5, maxZ: -halfL + 3.5 });

  const npcUpdate = (t: number): void => {
    for (const n of npcs) n.update(t);
  };

  const bounds: AABB = {
    minX: -halfW + 0.5,
    maxX: halfW - 0.5,
    minZ: -halfL + 0.5,
    maxZ: halfL - 0.5,
  };

  const spawn = new THREE.Vector3(0, 1.6, halfL - 2);

  const dispose = (): void => {
    for (const n of npcs) n.dispose();
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    root.clear();
  };

  return { root, colliders, bounds, npcUpdate, spawn, dispose };
}
