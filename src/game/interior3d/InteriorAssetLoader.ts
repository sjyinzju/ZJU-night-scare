import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { RoomKind } from "./buildRoom";
import { assetUrl } from "../assetPath";
import { buildInteriorCollisionMap, type InteriorCollisionMap } from "./InteriorCollisionMap";

export interface InteriorAssetMeta {
  assetVersion: number;
  buildingId: string;
  roomKind: RoomKind;
  model: string;
  additionalModels?: string[];
  lodModel?: string;
  qualityProfile?: string;
  sourceAssets?: string[];
  assetStats?: Record<string, unknown>;
  spawn?: { x: number; y: number; z: number; yaw?: number };
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number };
  redLights?: Array<{ x: number; y: number; z: number; color?: number; intensity?: number; distance?: number }>;
  flickerLights?: Array<{
    name?: string;
    x?: number;
    y: number;
    z?: number;
    color?: number;
    intensity?: number;
    distance?: number;
    speed?: number;
    phase?: number;
    followPickupId?: string;
  }>;
  pickupVisuals?: Record<string, string[]>;
  storyVisuals?: Record<string, string[]>;
  phaseVisuals?: Array<{ names: string[]; activeSceneIds: string[] }>;
  storySpots?: Record<string, { x: number; y: number; z: number; radius?: number }>;
  storySpotCandidates?: Record<string, Array<{ x: number; y: number; z: number; radius?: number }>>;
  pickupSpots?: Record<string, Array<{ x: number; y?: number; z: number; radius?: number }>>;
  fallReveal?: {
    triggerSceneId: string;
    fallenName: string;
    streetlampName: string;
    lamp: { x: number; y: number; z: number };
    body: { x: number; y: number; z: number };
    triggerDistance?: number;
    approachMinX?: number;
    mapBounds?: { minX: number; maxX: number; minZ: number; maxZ: number };
  };
  exitSegment?: { minX: number; maxX: number; z: number };
  navigationClearZones?: Array<{
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    kind?: "wall" | "shelf" | "furniture";
  }>;
  /** Authored repairs for exterior walls missing from the source Baisha GLB. */
  baishaBoundaryWalls?: Array<{
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    baseY: number;
    topY: number;
    /** False when the source GLB already supplies the visible wall. */
    visible?: boolean;
  }>;
  baishaLighting?: {
    revealAhead?: number;
    fixtures: Array<{
      id: string;
      x: number;
      y: number;
      z: number;
      axis: "x" | "z";
      zone: "room" | "balcony" | "corridor";
    }>;
    lightning?: {
      x: number;
      y: number;
      z: number;
      targetX: number;
      targetY: number;
      targetZ: number;
    };
  };
  baishaCorridorWindow?: {
    x: number;
    y: number;
    z: number;
    width: number;
    height: number;
    visualCutNames: string[];
  };
  baishaRaisedCeiling?: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    baseY: number;
    raisedY: number;
    visualCutNames: string[];
  };
  baishaGameplay?: {
    photo: { x: number; y: number; z: number; radius: number };
    balcony: { x: number; y: number; z: number; radius: number };
    computer: {
      x: number;
      y: number;
      z: number;
      radius: number;
      visualNames?: string[];
    };
    door: {
      visualNames: string[];
      collisionBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
    };
    chasePrep?: {
      ghost: { x: number; y: number; z: number };
      exitThresholdZ: number;
      fleeDirectionX: number;
      fleeDirectionZ: number;
      fleeDistance: number;
      viewDistance: number;
    };
    chase?: {
      ghostVisualName: string;
      ghostYawOffset?: number;
      fullSpeed: number;
      captureDistance: number;
      encounterDistance: number;
      jumpscareDuration: number;
      openingHoldSeconds: number;
      openingHalfSpeedSeconds: number;
      encounterGraceSeconds: number;
      encounterHalfSpeedSeconds: number;
      repathSeconds?: number;
      navigation: {
        nodes: Array<{ id: string; x: number; z: number }>;
        edges: Array<{
          from: string;
          to: string;
          requiresExitOpen?: boolean;
          targetable?: boolean;
        }>;
        /** Mandatory opening route: tail the player, enter the white-marked door, then traverse the shortcut. */
        shortcutNodeIds: string[];
      };
      triangle: { x: number; z: number; radius: number };
      trueExit: {
        visualNames: string[];
        clearZones: Array<{
          minX: number;
          maxX: number;
          minZ: number;
          maxZ: number;
          kind?: "wall" | "shelf" | "furniture";
        }>;
        trigger: { x: number; z: number; radius: number };
        unlockZone?: { minX: number; maxX: number; minZ: number; maxZ: number };
      };
      checkpoint: { x: number; y: number; z: number; yaw: number };
    };
    minimap?: {
      paths: Array<Array<{ x: number; z: number }>>;
      falseExitSegment: { minX: number; maxX: number; z: number };
      trueExitSegment: { minX: number; maxX: number; z: number };
    };
  };
  notes?: string[];
}

type BaishaChaseConfig = NonNullable<NonNullable<InteriorAssetMeta["baishaGameplay"]>["chase"]>;

export interface InteriorAssetHandle {
  root: THREE.Group;
  meta?: InteriorAssetMeta;
  bounds: THREE.Box3;
  collisionMap: InteriorCollisionMap;
  viewpoint?: {
    position: THREE.Vector3;
    yaw: number;
    pitch: number;
  };
  dispose: () => void;
}

export interface InteriorAssetRequest {
  buildingId: string;
  roomKind: RoomKind;
  isMobile: boolean;
}

interface InteriorAssetSource {
  rootPath: string;
  model: string;
  lodModel?: string;
  additionalModels?: string[];
  metaFile?: string;
  viewpointName?: string;
  previewViewpoint?: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch?: number;
  };
}

/** Resolve Blender/GLB source names after GLTFLoader removes track-reserved characters. */
export function getInteriorAssetObject(root: THREE.Object3D, authoredName: string): THREE.Object3D | undefined {
  return root.getObjectByName(authoredName)
    ?? root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(authoredName));
}

const ASSET_SOURCES: Record<string, InteriorAssetSource> = {
  // This pass intentionally swaps only the authored visual. The procedural
  // room remains the collision/interaction authority, so future story spots,
  // props and phase visuals can be mapped through metadata without coupling
  // them to the GLB itself.
  "medical-library:library": {
    rootPath: "models/interiors/library",
    model: "library.glb",
    additionalModels: ["library-scene01-props.glb"],
    metaFile: "scene01.meta.json",
    viewpointName: "新页面",
    previewViewpoint: { x: 8.62, y: 1.6, z: 10.53, yaw: Math.PI / 4, pitch: -0.3 },
  },
  "dorm-baisha:dorm": {
    rootPath: "models/interiors/baisha",
    model: "baisha.glb",
    metaFile: "scene01.meta.json",
  },
};

let loader: import("three/examples/jsm/loaders/GLTFLoader.js").GLTFLoader | undefined;

async function getLoader(): Promise<import("three/examples/jsm/loaders/GLTFLoader.js").GLTFLoader> {
  if (!loader) {
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    loader = new GLTFLoader();
  }
  return loader;
}

function assetKey(req: InteriorAssetRequest): string {
  return `${req.buildingId}:${req.roomKind}`;
}

async function loadMeta(rootPath: string, metaFile: string): Promise<InteriorAssetMeta | undefined> {
  try {
    const response = await fetch(assetUrl(`${rootPath}/${metaFile}`));
    if (!response.ok) return undefined;
    return (await response.json()) as InteriorAssetMeta;
  } catch {
    return undefined;
  }
}

function getAuthoredViewpoint(root: THREE.Group, name?: string): InteriorAssetHandle["viewpoint"] {
  if (!name) return undefined;
  root.updateMatrixWorld(true);
  const node = getInteriorAssetObject(root, name);
  if (!node) return undefined;

  const position = node.getWorldPosition(new THREE.Vector3());
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(node.getWorldQuaternion(new THREE.Quaternion()));
  const yaw = Math.atan2(-forward.x, -forward.z);
  const pitch = Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1));
  return { position, yaw, pitch };
}

function getPreviewViewpoint(
  source: InteriorAssetSource,
  root: THREE.Group,
  meta?: InteriorAssetMeta,
): InteriorAssetHandle["viewpoint"] {
  if (source.previewViewpoint) {
    const view = source.previewViewpoint;
    return {
      position: new THREE.Vector3(view.x, view.y, view.z),
      yaw: view.yaw,
      pitch: view.pitch ?? 0,
    };
  }
  if (meta?.spawn) {
    return {
      position: new THREE.Vector3(meta.spawn.x, meta.spawn.y, meta.spawn.z),
      yaw: meta.spawn.yaw ?? 0,
      pitch: 0,
    };
  }
  return getAuthoredViewpoint(root, source.viewpointName);
}

function tuneLoadedScene(root: THREE.Group): void {
  root.name = "medical-library-asset";
  const tunedMaterials = new Set<THREE.Material>();
  const tunedTextures = new Set<THREE.Texture>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of materials) {
      if (tunedMaterials.has(mat)) continue;
      tunedMaterials.add(mat);
      const standard = mat as THREE.MeshStandardMaterial;
      for (const texture of [standard.map, standard.normalMap, standard.roughnessMap, standard.metalnessMap]) {
        if (!texture || tunedTextures.has(texture)) continue;
        tunedTextures.add(texture);
        texture.anisotropy = Math.max(texture.anisotropy, 4);
      }
      standard.needsUpdate = true;
    }
  });
}

function applyBaishaWindowCutout(
  root: THREE.Group,
  windowConfig?: InteriorAssetMeta["baishaCorridorWindow"],
): void {
  if (!windowConfig) return;
  const { x, y, z, width, height } = windowConfig;
  const minY = y - height * 0.5;
  const maxY = y + height * 0.5;
  const minZ = z - width * 0.5;
  const maxZ = z + width * 0.5;
  const patchMaterial = (source: THREE.Material): THREE.Material => {
    const material = source.clone();
    const cacheKey = `baisha-window-${x}-${y}-${z}-${width}-${height}`;
    material.customProgramCacheKey = () => cacheKey;
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vBaishaWindowWorld;")
        .replace(
          "#include <worldpos_vertex>",
          "#include <worldpos_vertex>\nvBaishaWindowWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;",
        );
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vBaishaWindowWorld;")
        .replace(
          "#include <clipping_planes_fragment>",
          `#include <clipping_planes_fragment>\nif (vBaishaWindowWorld.x > ${(x - 0.42).toFixed(5)} && vBaishaWindowWorld.x < ${(x + 0.42).toFixed(5)} && vBaishaWindowWorld.y > ${minY.toFixed(5)} && vBaishaWindowWorld.y < ${maxY.toFixed(5)} && vBaishaWindowWorld.z > ${minZ.toFixed(5)} && vBaishaWindowWorld.z < ${maxZ.toFixed(5)}) discard;`,
        );
    };
    material.needsUpdate = true;
    return material;
  };

  for (const name of windowConfig.visualCutNames) {
    const object = getInteriorAssetObject(root, name);
    object?.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(patchMaterial)
        : patchMaterial(mesh.material);
    });
  }
}

/** Cut only the low shortcut ceiling; Interior3D supplies its raised replacement. */
function applyBaishaRaisedCeilingCutout(
  root: THREE.Group,
  ceiling?: InteriorAssetMeta["baishaRaisedCeiling"],
): void {
  if (!ceiling) return;
  const { minX, maxX, minZ, maxZ, baseY } = ceiling;
  const patchMaterial = (source: THREE.Material): THREE.Material => {
    const material = source.clone();
    const priorCompile = source.onBeforeCompile;
    const priorCacheKey = source.customProgramCacheKey();
    material.customProgramCacheKey = () => `${priorCacheKey}|baisha-raised-ceiling-${minX}-${maxX}-${minZ}-${maxZ}-${baseY}`;
    material.onBeforeCompile = (shader, renderer) => {
      priorCompile.call(source, shader, renderer);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vBaishaCeilingWorld;")
        .replace(
          "#include <worldpos_vertex>",
          "#include <worldpos_vertex>\nvBaishaCeilingWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;",
        );
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vBaishaCeilingWorld;")
        .replace(
          "#include <clipping_planes_fragment>",
          `#include <clipping_planes_fragment>\nif (vBaishaCeilingWorld.x > ${minX.toFixed(5)} && vBaishaCeilingWorld.x < ${maxX.toFixed(5)} && vBaishaCeilingWorld.z > ${minZ.toFixed(5)} && vBaishaCeilingWorld.z < ${maxZ.toFixed(5)} && vBaishaCeilingWorld.y > ${(baseY - 0.08).toFixed(5)} && vBaishaCeilingWorld.y < ${(baseY + 0.08).toFixed(5)}) discard;`,
        );
    };
    material.needsUpdate = true;
    return material;
  };

  for (const name of ceiling.visualCutNames) {
    const object = getInteriorAssetObject(root, name);
    object?.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(patchMaterial)
        : patchMaterial(mesh.material);
    });
  }
}

/**
 * SketchUp exported most Baisha nodes with the same raw GLB name (`Geom3D`).
 * Blender invents numbered suffixes while importing those duplicates, but
 * GLTFLoader cannot reproduce those names. Resolve the two authored exit doors
 * by their gameplay clear zones before static batching, then give each door a
 * stable semantic group that the chase state can hide later.
 */
function prepareBaishaTrueExitVisuals(
  root: THREE.Group,
  trueExit?: BaishaChaseConfig["trueExit"],
): void {
  if (!trueExit) return;
  root.updateMatrixWorld(true);

  trueExit.clearZones.forEach((zone, index) => {
    const semanticName = trueExit.visualNames[index];
    if (!semanticName || getInteriorAssetObject(root, semanticName)) return;

    const candidates: THREE.Mesh[] = [];
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh) return;
      const box = new THREE.Box3().setFromObject(mesh);
      if (box.isEmpty()) return;
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const centerInsideZone = center.x >= zone.minX && center.x <= zone.maxX
        && center.z >= zone.minZ && center.z <= zone.maxZ;
      const isDoorScalePart = size.x <= 2.5 && size.y <= 3.5 && size.z <= 0.75;
      if (centerInsideZone && isDoorScalePart) candidates.push(mesh);
    });

    if (candidates.length === 0) return;
    const group = new THREE.Group();
    group.name = semanticName;
    root.add(group);
    for (const mesh of candidates) group.attach(mesh);
  });
}

/**
 * Baisha is a fully static SketchUp export: hundreds of separate meshes share
 * only ~110 materials. Flattening transforms and merging meshes that use the
 * exact same material preserves every vertex, texture and shadow flag while
 * reducing both the colour and shadow render passes from hundreds of submits.
 */
function batchStaticScene(root: THREE.Group, preserveNames: string[] = []): THREE.Group {
  root.updateMatrixWorld(true);
  const preservedObjects = preserveNames
    .map((name) => getInteriorAssetObject(root, name))
    .filter((object): object is THREE.Object3D => Boolean(object));
  const preservedMeshes = new Set<THREE.Object3D>();
  for (const object of preservedObjects) object.traverse((child) => preservedMeshes.add(child));
  const batches = new Map<string, { material: THREE.Material; geometries: THREE.BufferGeometry[] }>();
  const sourceGeometries = new Set<THREE.BufferGeometry>();
  let compatible = true;

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (preservedMeshes.has(mesh)) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (materials.length !== 1 || mesh.geometry.groups.length > 1 || (mesh as THREE.SkinnedMesh).isSkinnedMesh) {
      compatible = false;
      return;
    }
    const material = materials[0];
    // The dorm is small enough that the full authored model is already inside
    // the camera/flashlight pass from the playable room. Grouping by exact
    // material therefore removes redundant colour + shadow submissions without
    // changing any vertex, texture, material or light/shadow setting.
    const batchKey = material.uuid;
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    const batch = batches.get(batchKey) ?? { material, geometries: [] };
    batch.geometries.push(geometry);
    batches.set(batchKey, batch);
    sourceGeometries.add(mesh.geometry);
  });

  if (!compatible || batches.size === 0) {
    for (const batch of batches.values()) for (const geometry of batch.geometries) geometry.dispose();
    return root;
  }

  const batchedRoot = new THREE.Group();
  batchedRoot.name = "baisha-static-batches";
  let index = 0;
  for (const { material, geometries } of batches.values()) {
    const merged = mergeGeometries(geometries, false);
    for (const geometry of geometries) geometry.dispose();
    if (!merged) {
      for (const child of batchedRoot.children) (child as THREE.Mesh).geometry.dispose();
      return root;
    }
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `baisha_static_batch_${index++}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    batchedRoot.add(mesh);
  }

  for (const geometry of sourceGeometries) geometry.dispose();
  root.clear();
  for (const object of preservedObjects) batchedRoot.attach(object);
  batchedRoot.matrixAutoUpdate = false;
  batchedRoot.updateMatrix();
  return batchedRoot;
}

function disposeLoadedScene(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      materials.add(mat);
      const standard = mat as THREE.MeshStandardMaterial;
      for (const texture of [standard.map, standard.normalMap, standard.roughnessMap, standard.metalnessMap]) {
        if (texture) textures.add(texture);
      }
    }
  });

  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}

export async function loadInteriorAsset(req: InteriorAssetRequest): Promise<InteriorAssetHandle | null> {
  const source = ASSET_SOURCES[assetKey(req)];
  if (!source) return null;

  const meta = source.metaFile ? await loadMeta(source.rootPath, source.metaFile) : undefined;
  const preferredModel = req.isMobile
    ? (source.lodModel ?? meta?.lodModel ?? source.model)
    : (meta?.model ?? source.model);
  const gltfLoader = await getLoader();
  const extraModels = meta?.additionalModels ?? source.additionalModels ?? [];
  const [gltf, ...extras] = await Promise.all([
    gltfLoader.loadAsync(assetUrl(`${source.rootPath}/${preferredModel}`)),
    ...extraModels.map((model) => gltfLoader.loadAsync(assetUrl(`${source.rootPath}/${model}`))),
  ]);
  const authoredBaseRoot = gltf.scene as THREE.Group;
  tuneLoadedScene(authoredBaseRoot);
  const bounds = new THREE.Box3().setFromObject(authoredBaseRoot);
  // Collision is projected from the original object granularity. Rendering
  // batches must never change obstacle classification or navigation gaps.
  const collisionMap = buildInteriorCollisionMap(authoredBaseRoot, bounds);
  if (req.buildingId === "dorm-baisha" && req.roomKind === "dorm") {
    prepareBaishaTrueExitVisuals(authoredBaseRoot, meta?.baishaGameplay?.chase?.trueExit);
    applyBaishaWindowCutout(authoredBaseRoot, meta?.baishaCorridorWindow);
    applyBaishaRaisedCeilingCutout(authoredBaseRoot, meta?.baishaRaisedCeiling);
  }
  const baishaPreserveNames = [
    ...(meta?.baishaGameplay?.door.visualNames ?? []),
    ...(meta?.baishaGameplay?.computer.visualNames ?? []),
    ...(meta?.baishaGameplay?.chase?.trueExit.visualNames ?? []),
  ];
  const baseRoot = req.buildingId === "dorm-baisha" && req.roomKind === "dorm"
    ? batchStaticScene(authoredBaseRoot, baishaPreserveNames)
    : authoredBaseRoot;
  const root = new THREE.Group();
  root.name = "medical-library-asset";
  root.add(baseRoot);
  for (const extra of extras) {
    const extraRoot = extra.scene as THREE.Group;
    tuneLoadedScene(extraRoot);
    root.add(extraRoot);
  }
  const viewpoint = getPreviewViewpoint(source, root, meta);

  return {
    root,
    meta,
    bounds,
    collisionMap,
    viewpoint,
    dispose: () => disposeLoadedScene(root),
  };
}
