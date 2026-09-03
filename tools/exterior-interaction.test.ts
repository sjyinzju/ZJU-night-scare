import assert from "node:assert/strict";
import {
  EXTERIOR_AUTO_INTERACTION_RADIUS,
  shouldAutoTriggerExteriorHotspot,
} from "../src/game/exteriorInteraction";
import { storyHotspots } from "../src/game/storyData";

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

console.log(`Exterior interaction contract verified (${storyHotspots.length} hotspots).`);
