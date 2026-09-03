import type { RoomKind } from "./buildRoom";

/**
 * One Blender/glTF scene that can replace a procedural interior.
 *
 * Keep entries disabled until the matching files have been uploaded to
 * public/models locally or to VITE_ASSET_CDN_URL in production. This lets us
 * land the integration contract before the final art exists without adding
 * failed requests or changing the current playable rooms.
 */
export interface InteriorAssetSource {
  buildingId: string;
  roomKind: RoomKind;
  rootPath: string;
  manifest?: string;
  desktopModel?: string;
  mobileModel?: string;
  enabled: boolean;
}

export type InteriorAssetSourceOverride = Omit<InteriorAssetSource, "enabled"> & {
  enabled?: boolean;
};

export const INTERIOR_ASSET_SOURCES: readonly InteriorAssetSource[] = [
  {
    buildingId: "medical-library",
    roomKind: "library",
    rootPath: "models/interiors/medical-library",
    manifest: "scene.meta.json",
    desktopModel: "scene.glb",
    mobileModel: "scene.lod.glb",
    // This asset was rolled back because its old collision layout did not
    // match the visible scene. Re-enable after it exports COL_ nodes.
    enabled: false,
  },
  {
    buildingId: "medical-college",
    roomKind: "medical",
    rootPath: "models/interiors/medical-college",
    manifest: "scene.meta.json",
    desktopModel: "scene.glb",
    mobileModel: "scene.lod.glb",
    enabled: false,
  },
  {
    buildingId: "dorm-baisha",
    roomKind: "dorm",
    rootPath: "models/interiors/dorm-baisha",
    manifest: "scene.meta.json",
    desktopModel: "scene.glb",
    mobileModel: "scene.lod.glb",
    enabled: false,
  },
  {
    buildingId: "little-theater",
    roomKind: "hall",
    rootPath: "models/interiors/little-theater",
    manifest: "scene.meta.json",
    desktopModel: "scene.glb",
    mobileModel: "scene.lod.glb",
    enabled: false,
  },
];

export function findInteriorAssetSource(
  buildingId: string,
  roomKind: RoomKind,
): InteriorAssetSource | undefined {
  return INTERIOR_ASSET_SOURCES.find(
    (source) => source.enabled && source.buildingId === buildingId && source.roomKind === roomKind,
  );
}
