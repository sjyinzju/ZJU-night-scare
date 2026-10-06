import { assetUrl } from "./assetPath";
import { THEATER_IMAGE_CACHE_VERSION } from "./interior3d/theaterData";

export interface ImageAssetDescriptor {
  path: string;
  version?: string;
  priority?: "high" | "low" | "auto";
}

type ImageAssetRecord = {
  image: HTMLImageElement;
  ready: Promise<boolean>;
};

export const MEDICAL_CCTV_IMAGE_VERSION = "medical-cctv-v3-webp";
export const MEDICAL_BASEMENT_IMAGE_VERSION = "medical-basement-v2";
export const BAISHA_IMAGE_CACHE_VERSION = "baisha-images-v1";
export const JUMPSCARE_IMAGE_CACHE_VERSION = "jumpscare-images-v3";

const imageAssetRecords = new Map<string, ImageAssetRecord>();

const BAISHA_VISUAL_ASSETS: readonly ImageAssetDescriptor[] = [
  { path: "images/baisha/dorm-photo-normal-v1.png", version: BAISHA_IMAGE_CACHE_VERSION, priority: "high" },
  { path: "images/baisha/dorm-photo-corrupt-v1.png", version: BAISHA_IMAGE_CACHE_VERSION, priority: "high" },
  { path: "images/baisha/balcony-silhouette-v1.png", version: BAISHA_IMAGE_CACHE_VERSION },
];

const MEDICAL_TOP_VISUAL_ASSETS: readonly ImageAssetDescriptor[] = [
  "normal-01.webp",
  "normal-02.webp",
  "normal-03.webp",
  "abnormal-a-01.webp",
  "abnormal-a-02.webp",
  "abnormal-b-01.webp",
  "abnormal-b-02.webp",
].map((file) => ({
  path: `images/medical-cctv/${file}`,
  version: MEDICAL_CCTV_IMAGE_VERSION,
}));

const MEDICAL_BASEMENT_VISUAL_ASSETS: readonly ImageAssetDescriptor[] = [
  "suwan-door-v1.png",
  "archive-intake-v1.png",
  "archive-anomaly-v1.png",
  "archive-blood-stain-v1.png",
  "archive-notebook-spread-v1.png",
].map((file) => ({
  path: `images/medical-basement/${file}`,
  version: MEDICAL_BASEMENT_IMAGE_VERSION,
  priority: "high" as const,
}));

const THEATER_VISUAL_ASSETS: readonly ImageAssetDescriptor[] = [
  "theater-mirror-01-normal.png",
  "theater-mirror-02-suwan.png",
  "theater-mirror-03-secondary-face.png",
  "theater-reel-r01-suwan-stage.png",
  "theater-reel-r02-warning.png",
  "theater-reel-r03-chen-edit.png",
  "theater-reel-r04-linwei.png",
  "theater-reel-r05-route.png",
  "theater-reel-r06-door.png",
  "theater-reel-r07a-baiqiu-remembers.png",
  "theater-reel-r07b-baiqiu-lost.png",
  "theater-reel-r08-refusal.png",
  "theater-reel-r09-present.png",
  "theater-stage-suwan-flash.png",
].map((file) => ({
  path: `images/theater/${file}`,
  version: THEATER_IMAGE_CACHE_VERSION,
}));

// Must stay in sync with CampusScene.preload(): same folders, same URL shape
// (no version param), so a warmed browser cache is a hit for Phaser's loader.
const EXTERIOR_BUILDING_IDS = [
  "main-gate",
  "dorm-lantian",
  "dorm-danyang",
  "dorm-cuibai",
  "medical-library",
  "medical-college",
  "dorm-baisha",
  "little-theater",
  "linhu-canteen",
  "west-teaching",
  "ocean-building",
  "qiushi-auditorium",
  "marine-lab",
  "engineering-lab",
  "agri-life",
  "library",
  "east-teaching-1",
  "east-teaching-2",
  "east-teaching-3",
  "east-teaching-4",
  "east-teaching-5",
  "east-teaching-6",
  "east-teaching-7",
  "gym",
  "life-science",
  "environment-college",
] as const;

const EXTERIOR_CAMPUS_ASSETS: readonly ImageAssetDescriptor[] = [
  ...EXTERIOR_BUILDING_IDS.map((buildingId) => ({
    path: `assets/exterior/${buildingId}/${buildingId}.png`,
    priority: "low" as const,
  })),
  { path: "assets/exterior/crescent-building/crescent-building.png", priority: "low" as const },
  { path: "assets/exterior/admin-center/admin-center.png", priority: "low" as const },
];

function createImageAssetRecord(descriptor: ImageAssetDescriptor): ImageAssetRecord {
  // Deliberately NO crossOrigin: the DOM <img> render targets fetch these URLs
  // without CORS, and the browser caches the two request modes as separate
  // variants (Vary: Origin). A CORS-mode preload warms a variant the renderer
  // never uses, and once the no-cors variant is cached the CORS request can be
  // failed outright for the rest of the session. decode()/naturalWidth need no
  // CORS access.
  const image = new Image();
  image.decoding = "async";
  image.fetchPriority = descriptor.priority ?? "auto";
  const url = assetUrl(descriptor.path, descriptor.version);

  const ready = new Promise<boolean>((resolve) => {
    image.onload = () => {
      void image.decode().then(
        () => resolve(true),
        () => {
          const usable = image.complete && image.naturalWidth > 0;
          // A false result must never persist in the record map, or every
          // later scare in the session falls back to the procedural face.
          // The group preloader retries once immediately; a later scene
          // entry can retry again if connectivity returned in the meantime.
          if (!usable) imageAssetRecords.delete(url);
          resolve(usable);
        },
      );
    };
    image.onerror = () => {
      imageAssetRecords.delete(url);
      resolve(false);
    };
  });

  image.src = url;
  return { image, ready };
}

function getImageAssetRecord(descriptor: ImageAssetDescriptor): ImageAssetRecord {
  const url = assetUrl(descriptor.path, descriptor.version);
  const cached = imageAssetRecords.get(url);
  if (cached) return cached;
  const created = createImageAssetRecord(descriptor);
  imageAssetRecords.set(url, created);
  return created;
}

/**
 * Download and decode a group of images, retaining their HTMLImageElements for
 * the session so the first visible frame never races the browser decoder.
 */
export async function preloadImageAssets(
  descriptors: readonly ImageAssetDescriptor[],
): Promise<boolean[]> {
  const firstPass = await Promise.all(descriptors.map((descriptor) => getImageAssetRecord(descriptor).ready));
  const retryIndexes = firstPass.flatMap((loaded, index) => loaded ? [] : [index]);
  if (retryIndexes.length === 0) return firstPass;

  const retries = await Promise.all(
    retryIndexes.map((index) => getImageAssetRecord(descriptors[index]).ready),
  );
  const result = [...firstPass];
  retryIndexes.forEach((index, retryIndex) => { result[index] = retries[retryIndex]; });
  return result;
}

export function preloadBaishaVisualAssets(): Promise<boolean[]> {
  return preloadImageAssets(BAISHA_VISUAL_ASSETS);
}

export function preloadMedicalTopVisualAssets(): Promise<boolean[]> {
  return preloadImageAssets(MEDICAL_TOP_VISUAL_ASSETS);
}

export function preloadMedicalBasementVisualAssets(): Promise<boolean[]> {
  return preloadImageAssets(MEDICAL_BASEMENT_VISUAL_ASSETS);
}

export function preloadMedicalVisualAssets(): Promise<boolean[][]> {
  return Promise.all([
    preloadMedicalTopVisualAssets(),
    preloadMedicalBasementVisualAssets(),
  ]);
}

export function preloadTheaterVisualAssets(): Promise<boolean[]> {
  return preloadImageAssets(THEATER_VISUAL_ASSETS);
}

/**
 * Warm the 2.5D campus building sprites while the player is still inside the
 * opening interior, so leaving the building does not pay the full exterior
 * download before Phaser can draw the map.
 */
export function preloadExteriorCampusAssets(): Promise<boolean[]> {
  return preloadImageAssets(EXTERIOR_CAMPUS_ASSETS);
}
