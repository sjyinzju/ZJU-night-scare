import fs from "node:fs";
import path from "node:path";

const workspace = process.cwd();
const oldModelPath = path.join(workspace, "public/models/interiors/medical-library/scene.glb");
const newModelPath = path.join(workspace, "public/models/interiors/library/library.glb");
const backupPath = path.join(workspace, "public/models/interiors/library/library.before-crimson-tubes.glb");

function parseGlb(filePath) {
  const file = fs.readFileSync(filePath);
  if (file.readUInt32LE(0) !== 0x46546c67 || file.readUInt32LE(4) !== 2) {
    throw new Error(`Unsupported GLB: ${filePath}`);
  }
  let offset = 12;
  let json;
  let bin = Buffer.alloc(0);
  while (offset < file.length) {
    const length = file.readUInt32LE(offset);
    const type = file.readUInt32LE(offset + 4);
    const data = file.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString("utf8").trimEnd());
    if (type === 0x004e4942) bin = Buffer.from(data);
    offset += 8 + length;
  }
  if (!json) throw new Error(`Missing JSON chunk: ${filePath}`);
  return { json, bin };
}

function writeGlb(filePath, json, rawBin) {
  const jsonData = Buffer.from(JSON.stringify(json));
  const jsonPadding = (4 - (jsonData.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonData, Buffer.alloc(jsonPadding, 0x20)]);
  const binPadding = (4 - (rawBin.length % 4)) % 4;
  const binChunk = Buffer.concat([rawBin, Buffer.alloc(binPadding)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binChunk.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  fs.writeFileSync(filePath, Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]));
}

if (!fs.existsSync(backupPath)) fs.copyFileSync(newModelPath, backupPath);

const source = parseGlb(oldModelPath);
const destination = parseGlb(backupPath);
const gltf = destination.json;
gltf.bufferViews ??= [];
gltf.accessors ??= [];
gltf.materials ??= [];
gltf.meshes ??= [];
gltf.nodes ??= [];

const copiedChunks = [destination.bin];
let binaryLength = destination.bin.length;
const viewMap = new Map();
const accessorMap = new Map();

function appendBufferView(sourceViewIndex) {
  if (viewMap.has(sourceViewIndex)) return viewMap.get(sourceViewIndex);
  const sourceView = source.json.bufferViews[sourceViewIndex];
  const padding = (4 - (binaryLength % 4)) % 4;
  if (padding) {
    copiedChunks.push(Buffer.alloc(padding));
    binaryLength += padding;
  }
  const start = sourceView.byteOffset ?? 0;
  const bytes = source.bin.subarray(start, start + sourceView.byteLength);
  const destinationView = {
    ...sourceView,
    buffer: 0,
    byteOffset: binaryLength,
  };
  const destinationIndex = gltf.bufferViews.push(destinationView) - 1;
  copiedChunks.push(bytes);
  binaryLength += bytes.length;
  viewMap.set(sourceViewIndex, destinationIndex);
  return destinationIndex;
}

function appendAccessor(sourceAccessorIndex) {
  if (accessorMap.has(sourceAccessorIndex)) return accessorMap.get(sourceAccessorIndex);
  const sourceAccessor = source.json.accessors[sourceAccessorIndex];
  const destinationAccessor = {
    ...sourceAccessor,
    bufferView: appendBufferView(sourceAccessor.bufferView),
  };
  const destinationIndex = gltf.accessors.push(destinationAccessor) - 1;
  accessorMap.set(sourceAccessorIndex, destinationIndex);
  return destinationIndex;
}

function appendMesh(sourceNodeIndex, materialIndex, name) {
  const sourceNode = source.json.nodes[sourceNodeIndex];
  const sourceMesh = source.json.meshes[sourceNode.mesh];
  const primitives = sourceMesh.primitives.map((primitive) => ({
    ...primitive,
    attributes: Object.fromEntries(
      Object.entries(primitive.attributes).map(([semantic, accessor]) => [semantic, appendAccessor(accessor)]),
    ),
    indices: primitive.indices === undefined ? undefined : appendAccessor(primitive.indices),
    material: materialIndex,
  }));
  return gltf.meshes.push({ name, primitives }) - 1;
}

const housingMaterial = gltf.materials.push({
  name: "legacy_crimson_fluorescent_housing",
  doubleSided: true,
  pbrMetallicRoughness: {
    baseColorFactor: [0.09, 0.075, 0.08, 1],
    metallicFactor: 0.42,
    roughnessFactor: 0.72,
  },
}) - 1;
const tubeMaterial = gltf.materials.push({
  name: "legacy_crimson_fluorescent_tube",
  doubleSided: true,
  emissiveFactor: [0.48, 0.008, 0.016],
  pbrMetallicRoughness: {
    baseColorFactor: [0.16, 0.012, 0.02, 1],
    metallicFactor: 0,
    roughnessFactor: 0.42,
  },
}) - 1;

const housingMesh = appendMesh(28, housingMaterial, "legacy_crimson_fluorescent_housing_mesh");
const tubeMesh = appendMesh(29, tubeMaterial, "legacy_crimson_fluorescent_tube_mesh");
const layout = [
  [3.3, 4.8, Math.PI / 2], [8.8, 4.8, Math.PI / 2], [14.1, 4.8, Math.PI / 2],
  [3.3, 9.2, Math.PI / 2], [8.8, 9.2, Math.PI / 2], [14.1, 9.2, Math.PI / 2],
  [-3.6, 14.0, Math.PI / 2], [2.0, 14.0, Math.PI / 2], [7.6, 14.0, Math.PI / 2],
  [-3.8, 24.0, 0], [0.0, 24.0, 0],
  [-3.8, 36.0, 0], [0.0, 36.0, 0],
  [-3.5, 48.0, 0], [-0.2, 48.0, 0],
  [-3.5, 56.0, 0], [-0.2, 56.0, 0],
];
const fixtureNodes = [];
for (let index = 0; index < layout.length; index++) {
  const [x, z, yaw] = layout[index];
  const housingNode = gltf.nodes.push({
    name: `legacy_crimson_fluorescent_${index}_housing`,
    mesh: housingMesh,
    translation: [0, 0.035, 0],
  }) - 1;
  const tubeNode = gltf.nodes.push({
    name: `legacy_crimson_fluorescent_${index}_tube`,
    mesh: tubeMesh,
    translation: [0, -0.035, 0],
  }) - 1;
  const fixtureNode = gltf.nodes.push({
    name: `legacy_crimson_fluorescent_${index}`,
    children: [housingNode, tubeNode],
    translation: [x, 3.52, z],
    rotation: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
  }) - 1;
  fixtureNodes.push(fixtureNode);
}
const arrayNode = gltf.nodes.push({
  name: "legacy_crimson_fluorescent_array",
  children: fixtureNodes,
}) - 1;
gltf.scenes[gltf.scene ?? 0].nodes.push(arrayNode);

const combinedBin = Buffer.concat(copiedChunks);
gltf.buffers[0].byteLength = combinedBin.length;
const temporaryPath = `${newModelPath}.tmp`;
writeGlb(temporaryPath, gltf, combinedBin);
fs.copyFileSync(temporaryPath, newModelPath);
fs.unlinkSync(temporaryPath);
console.log(`Injected ${layout.length} crimson fluorescent fixtures into ${newModelPath}`);
console.log(`Original preserved at ${backupPath}`);
