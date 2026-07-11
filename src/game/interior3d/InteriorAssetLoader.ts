import * as THREE from "three";
import type { RoomKind } from "./buildRoom";

export interface InteriorAssetMeta {
  assetVersion: number;
  buildingId: string;
  roomKind: RoomKind;
  model: string;
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
  phaseVisuals?: Array<{ names: string[]; activeSceneIds: string[] }>;
  storySpots?: Record<string, { x: number; y: number; z: number; radius?: number }>;
  pickupSpots?: Record<string, Array<{ x: number; y?: number; z: number }>>;
  notes?: string[];
}

export interface InteriorAssetHandle {
  root: THREE.Group;
  meta?: InteriorAssetMeta;
  dispose: () => void;
}

export interface InteriorAssetRequest {
  buildingId: string;
  roomKind: RoomKind;
  isMobile: boolean;
}

const ASSET_ROOTS: Record<string, string> = {
  "medical-library:library": "models/interiors/medical-library",
};

let loader: import("three/examples/jsm/loaders/GLTFLoader.js").GLTFLoader | undefined;

async function getLoader(): Promise<import("three/examples/jsm/loaders/GLTFLoader.js").GLTFLoader> {
  if (!loader) {
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    loader = new GLTFLoader();
  }
  return loader;
}

function assetUrl(path: string): string {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  return `${base}/${path.replace(/^\//, "")}`;
}

function assetKey(req: InteriorAssetRequest): string {
  return `${req.buildingId}:${req.roomKind}`;
}

async function loadMeta(rootPath: string): Promise<InteriorAssetMeta | undefined> {
  try {
    const response = await fetch(assetUrl(`${rootPath}/scene.meta.json`));
    if (!response.ok) return undefined;
    return (await response.json()) as InteriorAssetMeta;
  } catch {
    return undefined;
  }
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
  const rootPath = ASSET_ROOTS[assetKey(req)];
  if (!rootPath) return null;

  const meta = await loadMeta(rootPath);
  const preferredModel = req.isMobile ? (meta?.lodModel ?? "scene.lod.glb") : (meta?.model ?? "scene.glb");
  const gltfLoader = await getLoader();
  const gltf = await gltfLoader.loadAsync(assetUrl(`${rootPath}/${preferredModel}`));
  const root = gltf.scene as THREE.Group;
  tuneLoadedScene(root);

  return {
    root,
    meta,
    dispose: () => disposeLoadedScene(root),
  };
}
