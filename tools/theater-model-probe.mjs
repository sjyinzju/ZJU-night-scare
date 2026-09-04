// Geometry-only GLB reader for repeatable offline theater navigation checks.
// No image decoding, browser, or Blender import is needed; authored transforms
// and triangle data are retained, including duplicate SketchUp node names.
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import * as THREE from "three";

export function readModel(file) {
  const bytes = fs.readFileSync(file);
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString());
  const binary = bytes.subarray(28 + length);
  const arrays = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array };
  const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  function attribute(index) {
    const a = json.accessors[index], v = json.bufferViews[a.bufferView];
    const ArrayType = arrays[a.componentType], width = widths[a.type];
    if (v.byteStride && v.byteStride !== width * ArrayType.BYTES_PER_ELEMENT) throw Error("Interleaved accessor");
    const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const copy = Uint8Array.from(binary.subarray(start, start + a.count * width * ArrayType.BYTES_PER_ELEMENT));
    return new THREE.BufferAttribute(new ArrayType(copy.buffer), width);
  }
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const geometry = json.meshes.map(m => m.primitives.map(p => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", attribute(p.attributes.POSITION));
    if (p.indices != null) g.setIndex(attribute(p.indices));
    return g;
  }));
  const nodes = json.nodes.map((n, i) => {
    const o = new THREE.Group();
    o.name = n.name ?? `node_${i}`;
    o.userData.nodeIndex = i;
    if (n.matrix) new THREE.Matrix4().fromArray(n.matrix).decompose(o.position, o.quaternion, o.scale);
    else {
      if (n.translation) o.position.fromArray(n.translation);
      if (n.rotation) o.quaternion.fromArray(n.rotation);
      if (n.scale) o.scale.fromArray(n.scale);
    }
    if (n.mesh != null) geometry[n.mesh].forEach(g => o.add(new THREE.Mesh(g, material)));
    return o;
  });
  json.nodes.forEach((n, i) => n.children?.forEach(c => nodes[i].add(nodes[c])));
  const root = new THREE.Group();
  json.scenes[json.scene ?? 0].nodes.forEach(i => root.add(nodes[i]));
  root.updateMatrixWorld(true);
  const boxes = new Map();
  function boxFor(o) {
    const box = new THREE.Box3();
    if (o.isMesh) {
      o.geometry.computeBoundingBox();
      box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    }
    for (const child of o.children) box.union(boxFor(child));
    boxes.set(o, box);
    return box;
  }
  boxFor(root);
  return { root, nodes, boxes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { root, nodes, boxes } = readModel(process.argv[2] ?? "public/models/interiors/theater/theater.glb");
  const format = b => [b.min.toArray(), b.max.toArray()].map(p => p.map(n => +n.toFixed(3)));
  const ray = new THREE.Raycaster();
  for (const o of nodes) {
    const b = boxes.get(o), size = b.getSize(new THREE.Vector3());
    if (b.min.x > 22 && b.max.x < 24 && size.z > .6 && size.z < 3.5 && size.y > 1.8 && size.y < 3.3)
      console.log("BACKSTAGE_DOOR", o.userData.nodeIndex, o.name, JSON.stringify(format(b)));
    if (o.name === "medical_garage_ghost") {
      console.log("GHOST_AUTHORED", format(b), o.position.toArray(), o.scale.toArray());
      const clone = o.clone(true); clone.position.set(30, 0, -10.7); clone.rotation.y = -Math.PI / 2;
      console.log("GHOST_RUNTIME", format(new THREE.Box3().setFromObject(clone)));
    }
  }
  for (const x of [8.7, 15.4, 22.1, 23.5, 24.5, 27, 30, 31.8]) {
    const heights = [];
    for (let z = -13; z <= 4; z += .5) {
      ray.set(new THREE.Vector3(x, 2.2, z), new THREE.Vector3(0, -1, 0));
      const hits = ray.intersectObject(root, true);
      const floors = hits.filter(h => Math.abs(h.face.normal.clone().transformDirection(h.object.matrixWorld).y) > .95 && h.point.y < 1.85);
      heights.push([z, floors[0] ? +floors[0].point.y.toFixed(3) : null]);
    }
    console.log("HEIGHTS", x, JSON.stringify(heights));
  }
}
