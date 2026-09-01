import fs from "node:fs";
import path from "node:path";

// Turns the medical school's ORIGINAL square corridor ceiling panels into the
// red "legacy_crimson_fluorescent" fixtures, replacing the previously injected
// tube fixtures (which the user asked to remove).
//
// The model ships all 12 lamp diffusers merged into a single mesh (node 2006,
// material M00_Soft_Cloud): 7 panels along corridor A + 5 in the south strip.
// This script:
//   1. restores nothing itself — it always builds from the pristine backup;
//   2. clusters the merged mesh's triangles into 12 connected islands;
//   3. keeps the south-strip islands in the original mesh untouched;
//   4. re-meshes each corridor island as its own node named
//      legacy_crimson_fluorescent_<N>_tube with a dedicated crimson material,
//      so Interior3D.addAssetCeilingLights() discovers them exactly like the
//      library fixtures (emissive boost + pooled red point lights), without
//      touching the shared M00_Soft_Cloud material.
//
// Node positions are baked so each new node's world origin sits at its panel
// centre — addAssetCeilingLights() uses object.getWorldPosition() for the
// pooled light anchors.

const workspace = process.cwd();
const newModelPath = path.join(workspace, "public/models/interiors/medical-school/medical.glb");
const backupPath = path.join(workspace, "public/models/interiors/medical-school/medical.before-crimson-tubes.glb");
const SOURCE_NODE = 2006;
// Corridor A ceiling band in authored glTF coords (runtime z -3.4..1.4 shifted
// by the loader offset z +207.34, ceiling band y 3.2..3.35).
const CORRIDOR_Z = { min: -210.5, max: -206.0 };

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

const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const COMP_SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

if (!fs.existsSync(backupPath)) {
  throw new Error(`Pristine backup missing: ${backupPath}`);
}

const destination = parseGlb(backupPath);
const gltf = destination.json;

function readAccessor(bin, index) {
  const acc = gltf.accessors[index];
  const view = gltf.bufferViews[acc.bufferView];
  const Type = COMP[acc.componentType];
  const n = NCOMP[acc.type];
  const stride = view.byteStride ?? n * Type.BYTES_PER_ELEMENT;
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  if (stride === n * Type.BYTES_PER_ELEMENT) {
    return new Type(bin.buffer, bin.byteOffset + base, acc.count * n).slice();
  }
  const out = new Type(acc.count * n);
  for (let i = 0; i < acc.count; i++) {
    const start = bin.byteOffset + base + i * stride;
    out.set(new Type(bin.buffer, start, n), i);
  }
  return out;
}

// ── matrices ───────────────────────────────────────────────────────────────
function mat4Identity() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
function mat4Multiply(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  }
  return o;
}
function composeTRS(node) {
  if (node.matrix) return node.matrix;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
function transformPoint(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

// ── locate node 2006, its parent and its local matrix ─────────────────────
let parentIndex = -1;
for (let i = 0; i < gltf.nodes.length; i++) {
  if ((gltf.nodes[i].children ?? []).includes(SOURCE_NODE)) { parentIndex = i; break; }
}
if (parentIndex < 0) throw new Error(`Parent of node ${SOURCE_NODE} not found`);
const sourceNode = gltf.nodes[SOURCE_NODE];
const sourceLocal = composeTRS(sourceNode); // mesh-local -> parent space
const sourceMesh = gltf.meshes[sourceNode.mesh];
if (sourceMesh.primitives.length !== 1) throw new Error("Expected single-primitive panel mesh");
const primitive = sourceMesh.primitives[0];

const bin = destination.bin;
const pos = readAccessor(bin, primitive.attributes.POSITION);
const indices = primitive.indices !== undefined
  ? readAccessor(bin, primitive.indices)
  : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
const vertexCount = pos.length / 3;
const triCount = indices.length / 3;

// ── cluster triangles into connected islands ───────────────────────────────
const parent = new Uint32Array(vertexCount);
for (let i = 0; i < vertexCount; i++) parent[i] = i;
const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
const union = (a, b) => { parent[find(a)] = find(b); };
for (let t = 0; t < triCount; t++) {
  union(indices[t * 3], indices[t * 3 + 1]);
  union(indices[t * 3 + 1], indices[t * 3 + 2]);
}
const byPos = new Map();
for (let i = 0; i < vertexCount; i++) {
  const key = `${pos[i * 3].toFixed(5)},${pos[i * 3 + 1].toFixed(5)},${pos[i * 3 + 2].toFixed(5)}`;
  const existing = byPos.get(key);
  if (existing === undefined) byPos.set(key, i);
  else union(existing, i);
}
const islandTris = new Map(); // root -> triangle indices
for (let t = 0; t < triCount; t++) {
  const root = find(indices[t * 3]);
  const list = islandTris.get(root);
  if (list) list.push(t);
  else islandTris.set(root, [t]);
}

// ── island world centres (full parent chain) ───────────────────────────────
function worldMatrixOf(nodeIndex) {
  const chain = [];
  let current = nodeIndex;
  const parentOf = new Map();
  for (let i = 0; i < gltf.nodes.length; i++) {
    for (const child of gltf.nodes[i].children ?? []) parentOf.set(child, i);
  }
  while (current !== undefined) { chain.unshift(current); current = parentOf.get(current); }
  let m = mat4Identity();
  for (const idx of chain) m = mat4Multiply(m, composeTRS(gltf.nodes[idx]));
  return m;
}
const sourceWorld = worldMatrixOf(SOURCE_NODE);

const islands = [...islandTris.values()].map((tris) => {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const v = indices[t * 3 + k];
      const p = transformPoint(sourceWorld, pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
      for (let a = 0; a < 3; a++) {
        if (p[a] < min[a]) min[a] = p[a];
        if (p[a] > max[a]) max[a] = p[a];
      }
    }
  }
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  return { tris, min, max, center };
});
console.log(`islands: ${islands.length}`);
for (const island of islands) {
  console.log(`  worldCenter=[${island.center.map((v) => v.toFixed(2))}] tris=${island.tris.length}`);
}

const corridorIslands = islands
  .filter((island) => island.center[2] >= CORRIDOR_Z.min && island.center[2] <= CORRIDOR_Z.max)
  .sort((a, b) => a.center[0] - b.center[0]);
const corridorTris = new Set(corridorIslands.flatMap((island) => island.tris));
console.log(`corridor panels: ${corridorIslands.length}`);

// ── binary append helpers ──────────────────────────────────────────────────
const copiedChunks = [bin];
let binaryLength = bin.length;
function appendData(bytes) {
  const padding = (4 - (binaryLength % 4)) % 4;
  if (padding) {
    copiedChunks.push(Buffer.alloc(padding));
    binaryLength += padding;
  }
  const viewIndex = gltf.bufferViews.push({ buffer: 0, byteOffset: binaryLength, byteLength: bytes.length }) - 1;
  copiedChunks.push(Buffer.from(bytes));
  binaryLength += bytes.length;
  return viewIndex;
}
function appendAccessorFromTypedArray(data, type, componentType, minMax) {
  const viewIndex = appendData(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  const accessor = {
    bufferView: viewIndex,
    componentType,
    count: data.length / NCOMP[type],
    type,
  };
  if (minMax) {
    accessor.min = minMax.min;
    accessor.max = minMax.max;
  }
  return gltf.accessors.push(accessor) - 1;
}

// ── per-island rebuild ─────────────────────────────────────────────────────
const attributeNames = Object.keys(primitive.attributes);
const sourceAttributeData = new Map();
for (const name of attributeNames) {
  sourceAttributeData.set(name, readAccessor(bin, primitive.attributes[name]));
}

// Rotation part of sourceLocal for normals (uniform scale, so rotation suffices).
const rot = [
  [sourceLocal[0], sourceLocal[4], sourceLocal[8]],
  [sourceLocal[1], sourceLocal[5], sourceLocal[9]],
  [sourceLocal[2], sourceLocal[6], sourceLocal[10]],
];
const scaleX = Math.hypot(sourceLocal[0], sourceLocal[1], sourceLocal[2]);
for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) rot[r][c] /= scaleX;
const rotateNormal = (x, y, z) => {
  const nx = rot[0][0] * x + rot[0][1] * y + rot[0][2] * z;
  const ny = rot[1][0] * x + rot[1][1] * y + rot[1][2] * z;
  const nz = rot[2][0] * x + rot[2][1] * y + rot[2][2] * z;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
};

// Dedicated crimson material so the runtime emissive boost cannot leak into
// the shared M00_Soft_Cloud material used by the remaining panels.
const sourceMaterial = gltf.materials[primitive.material] ?? {};
const crimsonMaterial = gltf.materials.push({
  ...JSON.parse(JSON.stringify(sourceMaterial)),
  name: "legacy_crimson_fluorescent_tube",
  emissiveFactor: [0.48, 0.008, 0.016],
}) - 1;

const newNodeIndices = [];
for (let panelIndex = 0; panelIndex < corridorIslands.length; panelIndex++) {
  const island = corridorIslands[panelIndex];

  // Used vertices + remap.
  const used = [...new Set(island.tris.flatMap((t) => [indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]]))];
  const remap = new Map(used.map((oldIndex, newIndex) => [oldIndex, newIndex]));

  // Panel centre in PARENT space (source node's local transform only) — the
  // new node hangs under the same parent, so this is its translation.
  const pMin = [Infinity, Infinity, Infinity];
  const pMax = [-Infinity, -Infinity, -Infinity];
  for (const oldIndex of used) {
    const p = transformPoint(sourceLocal, pos[oldIndex * 3], pos[oldIndex * 3 + 1], pos[oldIndex * 3 + 2]);
    for (let a = 0; a < 3; a++) {
      if (p[a] < pMin[a]) pMin[a] = p[a];
      if (p[a] > pMax[a]) pMax[a] = p[a];
    }
  }
  const center = [(pMin[0] + pMax[0]) / 2, (pMin[1] + pMax[1]) / 2, (pMin[2] + pMax[2]) / 2];

  const newAttributes = {};
  for (const name of attributeNames) {
    const accessorIndex = primitive.attributes[name];
    const acc = gltf.accessors[accessorIndex];
    const n = NCOMP[acc.type];
    const Type = COMP[acc.componentType];
    const src = sourceAttributeData.get(name);
    const out = new Type(used.length * n);
    for (let i = 0; i < used.length; i++) {
      for (let k = 0; k < n; k++) out[i * n + k] = src[used[i] * n + k];
    }
    let minMax;
    if (name === "POSITION") {
      const transformed = new Float32Array(used.length * 3);
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < used.length; i++) {
        const p = transformPoint(sourceLocal, out[i * 3], out[i * 3 + 1], out[i * 3 + 2]);
        for (let a = 0; a < 3; a++) {
          transformed[i * 3 + a] = p[a] - center[a];
          if (transformed[i * 3 + a] < min[a]) min[a] = transformed[i * 3 + a];
          if (transformed[i * 3 + a] > max[a]) max[a] = transformed[i * 3 + a];
        }
      }
      newAttributes[name] = appendAccessorFromTypedArray(transformed, "VEC3", 5126, { min, max });
      continue;
    }
    if (name === "NORMAL") {
      const transformed = new Float32Array(used.length * 3);
      for (let i = 0; i < used.length; i++) {
        const normal = rotateNormal(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]);
        transformed.set(normal, i * 3);
      }
      newAttributes[name] = appendAccessorFromTypedArray(transformed, "VEC3", 5126);
      continue;
    }
    newAttributes[name] = appendAccessorFromTypedArray(out, acc.type, acc.componentType);
  }

  const newIndices = new (COMP[primitive.indices !== undefined ? gltf.accessors[primitive.indices].componentType : 5125])(island.tris.length * 3);
  for (let i = 0; i < island.tris.length; i++) {
    const t = island.tris[i];
    for (let k = 0; k < 3; k++) newIndices[i * 3 + k] = remap.get(indices[t * 3 + k]);
  }
  const indexAccessorIndex = appendAccessorFromTypedArray(
    newIndices,
    "SCALAR",
    primitive.indices !== undefined ? gltf.accessors[primitive.indices].componentType : 5125,
  );

  const meshIndex = gltf.meshes.push({
    name: `legacy_crimson_fluorescent_${panelIndex}_tube_mesh`,
    primitives: [{
      attributes: newAttributes,
      indices: indexAccessorIndex,
      material: crimsonMaterial,
      mode: primitive.mode ?? 4,
    }],
  }) - 1;
  const nodeIndex = gltf.nodes.push({
    name: `legacy_crimson_fluorescent_${panelIndex}_tube`,
    mesh: meshIndex,
    translation: center,
  }) - 1;
  newNodeIndices.push(nodeIndex);
}

// Original mesh keeps only the non-corridor (south strip) islands.
const remainingTris = [];
for (let t = 0; t < triCount; t++) if (!corridorTris.has(t)) remainingTris.push(t);
const remainingIndices = new (COMP[primitive.indices !== undefined ? gltf.accessors[primitive.indices].componentType : 5125])(remainingTris.length * 3);
for (let i = 0; i < remainingTris.length; i++) {
  const t = remainingTris[i];
  for (let k = 0; k < 3; k++) remainingIndices[i * 3 + k] = indices[t * 3 + k];
}
primitive.indices = appendAccessorFromTypedArray(
  remainingIndices,
  "SCALAR",
  primitive.indices !== undefined ? gltf.accessors[primitive.indices].componentType : 5125,
);

gltf.nodes[parentIndex].children.push(...newNodeIndices);

const combinedBin = Buffer.concat(copiedChunks);
gltf.buffers[0].byteLength = combinedBin.length;
const temporaryPath = `${newModelPath}.tmp`;
writeGlb(temporaryPath, gltf, combinedBin);
fs.copyFileSync(temporaryPath, newModelPath);
fs.unlinkSync(temporaryPath);
console.log(`Split ${corridorIslands.length} corridor panels into crimson fixtures in ${newModelPath}`);
console.log(`Original mesh keeps ${remainingTris.length} triangles (south strip panels)`);
