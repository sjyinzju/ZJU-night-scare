import assert from "node:assert/strict";
import {
  EXTERIOR_AUTO_INTERACTION_RADIUS,
  shouldAutoTriggerExteriorHotspot,
} from "../src/game/exteriorInteraction";
import { campusBuildings } from "../src/game/mapData";
import { getHotspotById, storyHotspots, storyScenes } from "../src/game/storyData";
import { resolvePostChoiceCommands } from "../src/game/storyEngine";

const authoredModes = new Set(storyHotspots.map((hotspot) => hotspot.mode));
assert.deepEqual(
  [...authoredModes].sort(),
  ["indoor-3d", "outdoor-text", "outdoor-to-indoor"],
  "the test must cover every authored exterior hotspot mode",
);

for (const hotspot of storyHotspots) {
  const insideSafeRadius = Math.min(EXTERIOR_AUTO_INTERACTION_RADIUS, hotspot.radius) - 0.01;
  assert.equal(
    shouldAutoTriggerExteriorHotspot(insideSafeRadius, hotspot.radius),
    true,
    `${hotspot.id} (${hotspot.mode}) must auto-trigger at close range`,
  );
  assert.equal(
    shouldAutoTriggerExteriorHotspot(EXTERIOR_AUTO_INTERACTION_RADIUS + 0.01, hotspot.radius),
    false,
    `${hotspot.id} must retain a wider manual-only E range`,
  );
}

const theaterHotspot = getHotspotById("theater")!;
const theaterBuilding = campusBuildings.find((building) => building.id === "little-theater")!;
assert.equal(theaterBuilding.enterable, true);
assert.equal(theaterHotspot.mode, "indoor-3d");
assert.equal(theaterHotspot.x, theaterBuilding.x + theaterBuilding.w / 2);
assert.ok(
  theaterHotspot.y > theaterBuilding.y + theaterBuilding.d
    && theaterHotspot.y - (theaterBuilding.y + theaterBuilding.d) < 0.5,
  "theater hotspot must sit directly outside the building's south entrance",
);

const lakeToTheater = resolvePostChoiceCommands({
  activeScene: storyScenes.reveal_villain,
  nextScene: storyScenes.final_plan,
  nextHotspot: theaterHotspot,
  changesLocation: true,
  inInterior: false,
});
assert.equal(
  lakeToTheater.some((command) => command.kind === "enter-building"),
  false,
  "finishing the lake story must not teleport the player into the theater",
);
assert.deepEqual(lakeToTheater, [
  { kind: "set-active-scene", sceneId: null },
  { kind: "show-objective", place: theaterHotspot.place, objective: theaterHotspot.objective },
]);

const dormPreludeToInterior = resolvePostChoiceCommands({
  activeScene: storyScenes.dorm_baiqiu,
  nextScene: storyScenes.dorm_forum,
  nextHotspot: getHotspotById("dorm"),
  changesLocation: false,
  inInterior: false,
});
assert.ok(
  dormPreludeToInterior.some((command) => command.kind === "enter-building"),
  "same-building outdoor preludes must still enter their interior after the choice",
);

console.log(`Exterior interaction contract verified (${storyHotspots.length} hotspots).`);
