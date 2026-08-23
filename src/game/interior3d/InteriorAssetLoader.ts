import * as THREE from "three";
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
  notes?: string[];
}

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
  const node = root.getObjectByName(name);
  if (!node) return undefined;

  const position = node.getWorldPosition(new THREE.Vector3());
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(node.getWorldQuaternion(new THREE.Quaternion()));
  const yaw = Math.atan2(-forward.x, -forward.z);
  const pitch = Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1));
  return { position, yaw, pitch };
}

function getPreviewViewpoint(source: InteriorAssetSource, root: THREE.Group): InteriorAssetHandle["viewpoint"] {
  if (source.previewViewpoint) {
    const view = source.previewViewpoint;
    return {
      position: new THREE.Vector3(view.x, view.y, view.z),
      yaw: view.yaw,
      pitch: view.pitch ?? 0,
    };
  }
  return getAuthoredViewpoint(root, source.viewpointName);
}

function tuneLoadedScene(root: THREE.Group): void {
  root.name = "medical-library-asset";
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of materials) {
      const standard = mat as THREE.MeshStandardMaterial;
      for (const texture of [standard.map, standard.normalMap, standard.roughnessMap, standard.metalnessMap]) {
        if (texture) texture.anisotropy = Math.max(texture.anisotropy, 4);
      }
      standard.needsUpdate = true;
    }
  });
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
  const baseRoot = gltf.scene as THREE.Group;
  tuneLoadedScene(baseRoot);
  const bounds = new THREE.Box3().setFromObject(baseRoot);
  const collisionMap = buildInteriorCollisionMap(baseRoot, bounds);
  const root = new THREE.Group();
  root.name = "medical-library-asset";
  root.add(baseRoot);
  for (const extra of extras) {
    const extraRoot = extra.scene as THREE.Group;
    tuneLoadedScene(extraRoot);
    root.add(extraRoot);
  }
  const viewpoint = getPreviewViewpoint(source, root);

  return {
    root,
    meta,
    bounds,
    collisionMap,
    viewpoint,
    dispose: () => disposeLoadedScene(root),
  };
}
