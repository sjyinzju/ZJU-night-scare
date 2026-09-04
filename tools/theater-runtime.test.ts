import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "three";
import { readModel } from "./theater-model-probe.mjs";
import { TheaterGameplayRuntime } from "../src/game/interior3d/TheaterGameplayRuntime";
import {
  theaterFloorHeightAt,
  THEATER_MAIN_DOOR_VISUAL_NAME,
  THEATER_BACKSTAGE_DOOR_VISUAL_NAME,
  THEATER_BACKSTAGE_REAR_DOOR_VISUAL_NAME,
  THEATER_SUWAN_JUMPSCARE_SPRITE,
} from "../src/game/interior3d/theaterData";
import { prepareTheaterDoorVisual, removeTheaterAudienceRows } from "../src/game/interior3d/theaterGeometry";
import { buildInteriorCollisionMap, cutObstacleByClearZone } from "../src/game/interior3d/InteriorCollisionMap";
import { AabbSpatialIndex } from "../src/game/interior3d/InteriorCollisionSpatialIndex";

Object.assign(globalThis, { window: new EventTarget() });
THREE.TextureLoader.prototype.load = function (_url, onLoad) {
  const texture = new THREE.Texture(); onLoad?.(texture); return texture;
};
const metaDocument = JSON.parse(fs.readFileSync("public/models/interiors/theater/theater-gameplay.meta.json", "utf8"));
const meta = metaDocument.theaterGameplay;
const model = readModel("public/models/interiors/theater/theater.glb");
const ghostAsset = readModel("public/models/interiors/medical-school/medical-garage-props.glb");
let failures = 0;
let lastModal = "";
let paused = false;
function check(name: string, run: () => void) {
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${(error as Error).message}`); }
}
const camera = new THREE.PerspectiveCamera();
const scene = new THREE.Scene();
let hits = 0;
let lookYaw = Math.PI / 2;
let lookPitch = 0.18;
let lookInputLocked = false;
const ghost = ghostAsset.root.getObjectByName("medical_garage_ghost")!.clone(true);
const doors = [
  prepareTheaterDoorVisual(model.root, meta.mainDoor, THEATER_MAIN_DOOR_VISUAL_NAME),
  prepareTheaterDoorVisual(model.root, meta.backstageDoor, THEATER_BACKSTAGE_DOOR_VISUAL_NAME),
  prepareTheaterDoorVisual(model.root, meta.backstageRearDoor, THEATER_BACKSTAGE_REAR_DOOR_VISUAL_NAME),
];
const removedRows = removeTheaterAudienceRows(model.root, meta.removedAudienceRows);
const removedCenterSections = (meta.removedAudienceSections ?? []).flatMap(section => (
  removeTheaterAudienceRows(model.root, section)
));
const rawCollisionMap = buildInteriorCollisionMap(model.root, model.boxes.get(model.root), {
  floorHeightAt: (x, z) => theaterFloorHeightAt(x, z, meta.walkableSurfaces),
  floorCutoff: .2, excludeObjects: doors,
});
check("the center section's fourth row is removed for the finale standing mark", () => {
  assert.equal(removedCenterSections.length, 1);
  assert.deepEqual(removedCenterSections.map(row => row.userData.nodeIndex), [6185]);
  assert.ok(removedCenterSections.every(row => row.parent === null));
  const sharedRowMesh = model.nodes[6775].children.find(child => (child as THREE.Mesh).isMesh) as THREE.Mesh;
  assert.ok(sharedRowMesh.userData.theaterPrunedTriangles > 0, "shared row fragments were not pruned");
  const section = meta.removedAudienceSections[0];
  const position = sharedRowMesh.geometry.getAttribute("position");
  const index = sharedRowMesh.geometry.getIndex();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let offset = 0; offset < (index?.count ?? position.count); offset += 3) {
    const ids = index
      ? [index.getX(offset), index.getX(offset + 1), index.getX(offset + 2)]
      : [offset, offset + 1, offset + 2];
    a.fromBufferAttribute(position, ids[0]).applyMatrix4(sharedRowMesh.matrixWorld);
    b.fromBufferAttribute(position, ids[1]).applyMatrix4(sharedRowMesh.matrixWorld);
    c.fromBufferAttribute(position, ids[2]).applyMatrix4(sharedRowMesh.matrixWorld);
    const center = a.clone().add(b).add(c).multiplyScalar(1 / 3);
    assert.ok(
      center.x < section.minX || center.x > section.maxX
      || center.y < section.minY || center.y > section.maxY
      || center.z < section.minZ || center.z > section.maxZ,
      `shared row triangle remained at ${center.toArray().join(",")}`,
    );
  }
  assert.ok(Math.abs(meta.audienceCenter.x - 15.424) < .01);
  assert.ok(Math.abs(meta.audienceCenter.z + 4.501) < .01);
});
check("browser-style Object3D seat-row parents are removed visually", () => {
  const root = new THREE.Group();
  const authoredRow = new THREE.Object3D();
  const seatMesh = new THREE.Mesh(new THREE.BoxGeometry(5.4, 1, .86));
  authoredRow.position.set(meta.audienceCenter.x, 1.08, meta.audienceCenter.z);
  authoredRow.add(seatMesh);
  root.add(authoredRow);
  const removed = removeTheaterAudienceRows(root, meta.removedAudienceSections[0]);
  assert.deepEqual(removed, [authoredRow]);
  assert.equal(authoredRow.parent, null);
});
check("stage apparition plane preserves its source 16:9 aspect at a larger size", () => {
  assert.ok(meta.stageFlash.width >= 8);
  assert.ok(Math.abs(meta.stageFlash.width / meta.stageFlash.height - 16 / 9) < .001);
});
const collisionMap = {
  ...rawCollisionMap,
  obstacles: rawCollisionMap.obstacles.flatMap(obstacle => (
    metaDocument.navigationClearZones?.reduce(
      (pieces, zone) => pieces.flatMap(piece => cutObstacleByClearZone(piece, zone)),
      [obstacle],
    ) ?? [obstacle]
  )),
};
check("the last two authored audience rows are removed before static batching", () => {
  assert.equal(removedRows.length, 2);
  assert.deepEqual(removedRows.map(row => row.userData.nodeIndex), [10072, 10896]);
  assert.ok(removedRows.every(row => row.parent === null));
});
check("both theater jumpscares share the agriculture/medicine hall Su Wan image", () => {
  assert.equal(THEATER_SUWAN_JUMPSCARE_SPRITE, "library-shelf");
});
check("chase has a distinct upper backstage exit at the auditorium rear corner", () => {
  assert.ok(meta.backstageRearDoor, "missing backstageRearDoor metadata");
  assert.ok(Math.abs(meta.backstageRearDoor.x - 22.92) < .02);
  assert.ok(Math.abs(meta.backstageRearDoor.z + 12.93) < .02);
  assert.ok(Math.abs(meta.backstageEscape.z + 12.93) < .02);
});
const blocked = (x: number, z: number) => collisionMap.obstacles.filter(b =>
  x > b.minX - .22 && x < b.maxX + .22 && z > b.minZ - .22 && z < b.maxZ + .22);
check("the finale standing mark is collision-free inside the removed center row", () => {
  const blockers = blocked(meta.audienceCenter.x, meta.audienceCenter.z);
  assert.equal(blockers.length, 0, JSON.stringify(blockers));
});
check("theater spatial index preserves every sampled collision while narrowing candidates", () => {
  const index = new AabbSpatialIndex(collisionMap.obstacles, 2.5, .22);
  let candidateTotal = 0;
  let sampleCount = 0;
  for (let x = 8; x <= 32.8; x += .25) for (let z = -23.4; z <= 5.8; z += .25) {
    const candidates = index.query(x, z);
    candidateTotal += candidates.length;
    sampleCount++;
    assert.equal(candidates.some(b => x > b.minX - .22 && x < b.maxX + .22 && z > b.minZ - .22 && z < b.maxZ + .22), blocked(x, z).length > 0, `index mismatch at ${x}, ${z}`);
  }
  assert.ok(candidateTotal / sampleCount < 100, `average candidates = ${candidateTotal / sampleCount}`);
});
check("authored backstage doorway is clear but the adjacent wall stays solid", () => {
  for (let x = 22.3; x < 23.8; x += .05) assert.equal(blocked(x, .47).length, 0, `door blocked at ${x}`);
  assert.ok(blocked(22.92, -1.2).length > 0, "wall south of real door must not be cut");
});
check("upper rear doorway is clear but its adjacent wall stays solid", () => {
  for (let x = 22.3; x < 23.8; x += .05) assert.equal(blocked(x, -12.93).length, 0, `rear door blocked at ${x}`);
  assert.ok(blocked(22.92, -11.75).length > 0, "wall beside rear door must remain solid");
});
check("WASD path up both real stair flights and landing has no baked blockers", () => {
  const waypoints = [[27.5,-4.4],[27.5,-8.3],[30,-8.3],[30,-12.1]];
  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i-1], b = waypoints[i];
    const count = Math.ceil(Math.hypot(a[0]-b[0], a[1]-b[1]) / .04);
    for (let j=0; j<=count; j++) {
      const x=a[0]+(b[0]-a[0])*j/count, z=a[1]+(b[1]-a[1])*j/count;
      assert.equal(blocked(x,z).length,0,`stairs blocked at ${x.toFixed(2)}, ${z.toFixed(2)}: ${JSON.stringify(blocked(x,z))}`);
    }
  }
});
check("stage side steps are traversable without a jump", () => {
  for (const x of [9.7, 21.2]) {
    for (let z = 1.1; z < 2.2; z += .04) assert.equal(blocked(x, z).length, 0, `stage steps blocked at ${x}, ${z}`);
  }
});
const runtime = new TheaterGameplayRuntime({ scene, camera, root: model.root, meta, ghost,
  photoFrame: new THREE.Group(), ambientLight: new THREE.AmbientLight(),
  fillLight: new THREE.HemisphereLight(), nearFillLight: new THREE.PointLight(),
  setPaused(value) { paused = value; },
  getCameraLook: () => ({ yaw: lookYaw, pitch: lookPitch }),
  setCameraLook(yaw, pitch) { lookYaw = yaw; lookPitch = pitch; },
  setLookInputLocked(value) { lookInputLocked = value; },
  onPickup() {}, onModal(value) { lastModal = value; }, onStateChange() {}, onChaseHit() { hits++; },
});
check("backstage anchor matches GLB wooden door (not a generated seal)", () => {
  assert.ok(Math.abs(meta.backstageDoor.x - 22.92) < .02);
  assert.ok(Math.abs(meta.backstageDoor.z - .47) < .02);
  assert.equal(scene.getObjectByName("theater_backstage_seal"), undefined);
});
check("ghost feet are above the actual stair tread", () => {
  const bounds = new THREE.Box3().setFromObject(ghost);
  assert.ok(bounds.min.y >= -.16 && bounds.min.y <= -.14, `foot Y = ${bounds.min.y}`);
});
check("dormant ghost is hidden behind clothes rack three from the control desk", () => {
  const rack = model.nodes[19954];
  const eye = new THREE.Vector3(meta.consoleSwitch.x, 1.6, meta.consoleSwitch.z);
  const towardGhost = ghost.position.clone().sub(eye);
  const ghostDistance = towardGhost.length();
  const hitsBeforeGhost = new THREE.Raycaster(eye, towardGhost.normalize())
    .intersectObject(rack, true)
    .filter(hit => hit.distance < ghostDistance);
  assert.ok(hitsBeforeGhost.length > 0, "clothes rack does not occlude the dormant ghost");
});
runtime.update(.016, new THREE.Vector3(meta.film.x, 3.25, meta.film.z), true);
runtime.completeFoyer();
check("backstage remains shut before entering hall", () => assert.equal(doors[1].visible,true));
runtime.update(.016, new THREE.Vector3(9.02, 3.25, -11.9), false);
check("entering hall hides the authored backstage door and disables its collider", () => {
  assert.equal(doors[1].visible,false);
  assert.equal(runtime.colliders.some(b => b.isActive?.() && .47 > b.minZ && .47 < b.maxZ && 22.92 > b.minX && 22.92 < b.maxX),false);
});
runtime.update(.016, new THREE.Vector3(23.6, 1.6, .47), false);
check("crossing backstage reseals the same authored door", () => assert.equal(doors[1].visible,true));
const lightCount = () => {
  let count = 0; scene.traverseVisible(o => { if ((o as THREE.Light).isLight) count++; }); return count;
};
const before = lightCount();
runtime.update(.016, new THREE.Vector3(meta.consoleSwitch.x, 1.6, meta.consoleSwitch.z), true);
check("mirror bulbs never change renderer light topology during ramp", () => {
  for (let i = 0; i < 180; i++) {
    runtime.update(1 / 60, new THREE.Vector3(25, 1.6, -3), false);
    assert.equal(lightCount(), before);
  }
});
// Complete the real state transitions even if the topology assertion failed.
runtime.update(.016, new THREE.Vector3(meta.mirror.x, 1.6, meta.mirror.z), true);
runtime.completeMirror();
runtime.update(.016, new THREE.Vector3(meta.consoleSwitch.x, 1.6, meta.consoleSwitch.z), true);
runtime.completeCutSong();
check("chase keeps the entrance sealed and opens only the upper rear exit", () => {
  assert.equal(doors[1].visible, true);
  assert.equal(doors[2].visible, false);
  assert.equal(runtime.colliders.some(b => b.isActive?.() && -12.93 > b.minZ && -12.93 < b.maxZ && 22.92 > b.minX && 22.92 < b.maxX), false);
});
check("chase contact triggers once and removes the ghost without ending escape", () => {
  for (let i = 0; i < 600; i++) runtime.update(1 / 60, ghost.position.clone(), false);
  assert.equal(hits, 1);
  assert.equal(ghost.visible, false);
  assert.equal(runtime.currentStage, "chase");
  runtime.update(.016, new THREE.Vector3(22.2, 3.4, -12.93), false);
  assert.equal(runtime.currentStage, "audience-target");
});
check("auditorium lights shut down rear-to-front at 1.5 second intervals before the stage cue", () => {
  const hallPools = scene.children.filter(object => object.name.startsWith("theater_hall_red_pool_")) as THREE.PointLight[];
  assert.equal(hallPools.length, 4);
  camera.position.set(meta.audienceCenter.x, 1.6, meta.audienceCenter.z);
  runtime.update(.016, camera.position, false);
  assert.equal(runtime.currentStage, "camera-align");
  assert.equal(paused, true);
  assert.equal(lookInputLocked, true);
  runtime.update(.65, camera.position, false);
  assert.equal(runtime.currentStage, "camera-align");
  assert.ok(lookYaw > Math.PI / 2 && lookYaw < 3.14, `mid-turn yaw = ${lookYaw}`);
  runtime.update(.72, camera.position, false);
  assert.equal(runtime.currentStage, "light-shutdown");
  const expectedYaw = Math.atan2(
    -(meta.stageLightTarget.x - camera.position.x),
    -(meta.stageLightTarget.z - camera.position.z),
  );
  assert.ok(Math.abs(lookYaw - expectedYaw) < .01, `final yaw ${lookYaw}, expected ${expectedYaw}`);
  runtime.update(.016, new THREE.Vector3(meta.audienceCenter.x, 1.6, meta.audienceCenter.z), false);
  assert.equal(hallPools.filter(light => light.intensity === 0).length, 1);
  for (let i = 0; i < 84; i++) runtime.update(1 / 60, camera.position, false);
  assert.equal(hallPools.filter(light => light.intensity === 0).length, 1);
  for (let i = 0; i < 10; i++) runtime.update(1 / 60, camera.position, false);
  assert.equal(hallPools.filter(light => light.intensity === 0).length, 2);
  for (let i = 0; i < 220; i++) runtime.update(1 / 60, camera.position, false);
  assert.equal(hallPools.every(light => light.intensity === 0), true);
  assert.equal(runtime.currentStage, "blackout");
  assert.equal(lastModal, "blackout");
});
check("floor support follows all authored backstage stair treads", () => {
  for (const [x, z, y] of [[27.5,-5.2,.03],[27.5,-5.9,.21],[27.5,-6.5,.39],
    [27.5,-7.2,.57],[29.9,-8.3,.75],[29.9,-9.5,.93],[29.9,-10.1,1.11],
    [29.9,-10.8,1.29],[29.9,-11.4,1.47],[29.9,-12.1,1.65]]) {
    assert.ok(Math.abs(theaterFloorHeightAt(x,z,meta.walkableSurfaces) - y) < .012, `stair (${x}, ${z}) expected ${y}`);
  }
});
runtime.dispose();
if (failures) process.exitCode = 1;
