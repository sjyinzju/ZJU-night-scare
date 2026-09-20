import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createBrotliCompress, createBrotliDecompress, constants as zlibConstants } from "node:zlib";

const projectRoot = path.resolve(import.meta.dirname, "..");
const outputRoot = path.join(projectRoot, ".r2-upload");
const requestedScene = process.argv.find((argument) => argument.startsWith("--scene="))?.split("=")[1] ?? "all";

const scenes = {
  library: {
    version: "library-scene01-v2",
    files: [
      "public/models/interiors/library/library.glb",
      "public/models/interiors/library/library-scene01-props.glb",
    ],
    staticFiles: [
      "public/models/interiors/library/scene01.meta.json",
      "public/images/jumpscares/library-shelf-ghost.png",
      "public/images/jumpscares/library-fall-ghost.png",
    ],
  },
  baisha: {
    version: "baisha-scene01-v2",
    files: [
      "public/models/interiors/baisha/baisha.glb",
      "public/models/interiors/baisha/baisha-dorm-props.glb",
      "public/models/interiors/baisha/baisha-corridor-props.glb",
      "public/models/interiors/baisha/baisha-chase-props.glb",
    ],
    staticFiles: [
      "public/models/interiors/baisha/scene01.meta.json",
      "public/images/baisha/dorm-photo-normal-v1.png",
      "public/images/baisha/dorm-photo-corrupt-v1.png",
      "public/images/baisha/balcony-silhouette-v1.png",
    ],
  },
  medical: {
    version: "medical-school-v17-basement-door-wall",
    files: [
      "public/models/interiors/medical-school/medical-top.glb",
      "public/models/interiors/medical-school/medical-garage.glb",
      "public/models/interiors/medical-school/medical-basement.glb",
      "public/models/interiors/medical-school/medical-top-601.glb",
      "public/models/interiors/medical-school/medical-top-603.glb",
      "public/models/interiors/medical-school/medical-top-605.glb",
      "public/models/interiors/medical-school/medical-top-props.glb",
      "public/models/interiors/medical-school/medical-garage-props.glb",
      "public/models/interiors/medical-school/medical-basement-props.glb",
    ],
    staticFiles: [
      "public/models/interiors/medical-school/top-gameplay.meta.json",
      "public/images/jumpscares/medical-garage-ghost.png",
      "public/images/medical-cctv/normal-01.webp",
      "public/images/medical-cctv/normal-02.webp",
      "public/images/medical-cctv/normal-03.webp",
      "public/images/medical-cctv/abnormal-a-01.webp",
      "public/images/medical-cctv/abnormal-a-02.webp",
      "public/images/medical-cctv/abnormal-b-01.webp",
      "public/images/medical-cctv/abnormal-b-02.webp",
      "public/images/medical-basement/suwan-door-v1.png",
      "public/images/medical-basement/archive-intake-v1.png",
      "public/images/medical-basement/archive-anomaly-v1.png",
      "public/images/medical-basement/archive-blood-stain-v1.png",
      "public/images/medical-basement/archive-notebook-spread-v1.png",
    ],
  },
  theater: {
    version: "theater-final-v9-seat-mesh-fade",
    files: [
      "public/models/interiors/theater/theater.glb",
      "public/models/interiors/theater/theater-gameplay-props.glb",
    ],
    staticFiles: [
      "public/models/interiors/theater/theater-gameplay.meta.json",
      "public/images/theater/theater-mirror-01-normal.png",
      "public/images/theater/theater-mirror-02-suwan.png",
      "public/images/theater/theater-mirror-03-secondary-face.png",
      "public/images/theater/theater-reel-r01-suwan-stage.png",
      "public/images/theater/theater-reel-r02-warning.png",
      "public/images/theater/theater-reel-r03-chen-edit.png",
      "public/images/theater/theater-reel-r04-linwei.png",
      "public/images/theater/theater-reel-r05-route.png",
      "public/images/theater/theater-reel-r06-door.png",
      "public/images/theater/theater-reel-r07a-baiqiu-remembers.png",
      "public/images/theater/theater-reel-r07b-baiqiu-lost.png",
      "public/images/theater/theater-reel-r08-refusal.png",
      "public/images/theater/theater-reel-r09-present.png",
      "public/images/theater/theater-stage-suwan-flash.png",
    ],
  },
  audio: {
    version: "game-audio-v1",
    staticFiles: [
      "public/audio/bgm/score-1.mp3",
      "public/audio/bgm/score-2.mp3",
      "public/audio/ambient/wind.wav",
      "public/audio/sfx/shake.wav",
      "public/audio/sfx/jumpscare.wav",
      "public/audio/sfx/reveal.wav",
      "public/audio/sfx/ending.wav",
      "public/audio/sfx/choice-select.wav",
      "public/audio/sfx/hover.wav",
      "public/audio/sfx/item.wav",
      "public/audio/sfx/ghost-hit.wav",
      "public/audio/sfx/death.wav",
      "public/audio/sfx/story-open.mp3",
    ],
  },
};

if (requestedScene !== "all" && !(requestedScene in scenes)) {
  throw new Error(`Unknown scene "${requestedScene}". Use --scene=library, --scene=baisha, --scene=medical, --scene=theater, --scene=audio, or --scene=all.`);
}

const selectedScenes = requestedScene === "all"
  ? Object.entries(scenes)
  : [[requestedScene, scenes[requestedScene]]];

async function sha256(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function sha256DecodedBrotli(filePath) {
  const hash = createHash("sha256");
  const decoded = createReadStream(filePath).pipe(createBrotliDecompress());
  for await (const chunk of decoded) hash.update(chunk);
  return hash.digest("hex");
}

async function compressRuntimeFile(sceneName, version, relativePath) {
  const sourcePath = path.join(projectRoot, relativePath);
  const artifactPath = path.join(outputRoot, `${relativePath}.br`);
  await mkdir(path.dirname(artifactPath), { recursive: true });

  await pipeline(
    createReadStream(sourcePath),
    createBrotliCompress({
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 9,
        [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_GENERIC,
      },
    }),
    createWriteStream(artifactPath),
  );

  const [sourceStats, artifactStats, sourceSha256, encodedSha256] = await Promise.all([
    stat(sourcePath),
    stat(artifactPath),
    sha256(sourcePath),
    sha256(artifactPath),
  ]);
  const decodedSha256 = await sha256DecodedBrotli(artifactPath);
  if (decodedSha256 !== sourceSha256) {
    throw new Error(`Brotli verification failed for ${relativePath}`);
  }
  const normalizedRelativePath = relativePath.replaceAll("\\", "/");
  return {
    scene: sceneName,
    version,
    sourcePath: normalizedRelativePath,
    artifactPath: path.relative(projectRoot, artifactPath).replaceAll("\\", "/"),
    objectKey: normalizedRelativePath,
    contentType: "model/gltf-binary",
    contentEncoding: "br",
    cacheControl: "public, max-age=31536000, immutable",
    rawBytes: sourceStats.size,
    encodedBytes: artifactStats.size,
    encodedRatio: Number((artifactStats.size / sourceStats.size).toFixed(4)),
    sourceSha256,
    encodedSha256,
    decodedSha256,
  };
}

async function prepareStaticFile(sceneName, version, relativePath) {
  const sourcePath = path.join(projectRoot, relativePath);
  const artifactPath = path.join(outputRoot, relativePath);
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await copyFile(sourcePath, artifactPath);
  const [sourceStats, sourceSha256, artifactSha256] = await Promise.all([
    stat(sourcePath),
    sha256(sourcePath),
    sha256(artifactPath),
  ]);
  if (sourceSha256 !== artifactSha256) throw new Error(`Copy verification failed for ${relativePath}`);
  const normalizedRelativePath = relativePath.replaceAll("\\", "/");
  const extension = path.extname(relativePath).toLowerCase();
  const contentTypes = {
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".webp": "image/webp",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
  };
  const contentType = contentTypes[extension] ?? "application/octet-stream";
  return {
    scene: sceneName,
    version,
    sourcePath: normalizedRelativePath,
    artifactPath: path.relative(projectRoot, artifactPath).replaceAll("\\", "/"),
    objectKey: normalizedRelativePath,
    contentType,
    cacheControl: "public, max-age=31536000, immutable",
    rawBytes: sourceStats.size,
    encodedBytes: sourceStats.size,
    encodedRatio: 1,
    sourceSha256,
    encodedSha256: artifactSha256,
    decodedSha256: sourceSha256,
  };
}

await rm(outputRoot, { recursive: true, force: true });
const files = [];
for (const [sceneName, scene] of selectedScenes) {
  for (const relativePath of scene.files ?? []) {
    files.push(await compressRuntimeFile(sceneName, scene.version, relativePath));
  }
  for (const relativePath of scene.staticFiles ?? []) {
    files.push(await prepareStaticFile(sceneName, scene.version, relativePath));
  }
}

const rawBytes = files.reduce((sum, file) => sum + file.rawBytes, 0);
const encodedBytes = files.reduce((sum, file) => sum + file.encodedBytes, 0);
const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  note: "Upload each artifact's compressed bytes to objectKey and preserve all listed HTTP metadata.",
  rawBytes,
  encodedBytes,
  encodedRatio: Number((encodedBytes / rawBytes).toFixed(4)),
  files,
};

await writeFile(
  path.join(outputRoot, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

console.log(`Prepared ${files.length} runtime assets in ${path.relative(projectRoot, outputRoot)}`);
console.log(`${(rawBytes / 1024 / 1024).toFixed(2)} MiB -> ${(encodedBytes / 1024 / 1024).toFixed(2)} MiB (${((1 - encodedBytes / rawBytes) * 100).toFixed(1)}% smaller)`);
