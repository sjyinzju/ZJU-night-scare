import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
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
  },
  baisha: {
    version: "baisha-scene01-v2",
    files: [
      "public/models/interiors/baisha/baisha.glb",
      "public/models/interiors/baisha/baisha-dorm-props.glb",
      "public/models/interiors/baisha/baisha-corridor-props.glb",
      "public/models/interiors/baisha/baisha-chase-props.glb",
    ],
  },
  medical: {
    version: "medical-top-gameplay-v7",
    files: [
      "public/models/interiors/medical-school/medical-top.glb",
      "public/models/interiors/medical-school/medical-garage.glb",
      "public/models/interiors/medical-school/medical-basement.glb",
      "public/models/interiors/medical-school/medical-top-601.glb",
      "public/models/interiors/medical-school/medical-top-603.glb",
      "public/models/interiors/medical-school/medical-top-605.glb",
      "public/models/interiors/medical-school/medical-top-props.glb",
    ],
  },
};

if (requestedScene !== "all" && !(requestedScene in scenes)) {
  throw new Error(`Unknown scene "${requestedScene}". Use --scene=library, --scene=baisha, --scene=medical, or --scene=all.`);
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

await rm(outputRoot, { recursive: true, force: true });
const files = [];
for (const [sceneName, scene] of selectedScenes) {
  for (const relativePath of scene.files) {
    files.push(await compressRuntimeFile(sceneName, scene.version, relativePath));
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

console.log(`Prepared ${files.length} runtime GLBs in ${path.relative(projectRoot, outputRoot)}`);
console.log(`${(rawBytes / 1024 / 1024).toFixed(2)} MiB -> ${(encodedBytes / 1024 / 1024).toFixed(2)} MiB (${((1 - encodedBytes / rawBytes) * 100).toFixed(1)}% smaller)`);
