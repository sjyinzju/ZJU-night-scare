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
export const JUMPSCARE_IMAGE_CACHE_VERSION = "jumpscare-images-v2";

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

function createImageAssetRecord(descriptor: ImageAssetDescriptor): ImageAssetRecord {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.decoding = "async";
  image.fetchPriority = descriptor.priority ?? "auto";
  const url = assetUrl(descriptor.path, descriptor.version);

  const ready = new Promise<boolean>((resolve) => {
    image.onload = () => {
      void image.decode().then(
        () => resolve(true),
        () => resolve(image.complete && image.naturalWidth > 0),
      );
    };
    image.onerror = () => {
      // A failed CDN response must not poison the whole session. The group
      // preloader retries once immediately, and a later scene entry can retry
      // again if connectivity returned in the meantime.
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
