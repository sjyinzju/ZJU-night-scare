import assert from "node:assert/strict";
import { shouldUseMedicalDevelopmentStart } from "../src/game/developmentMode";

assert.equal(
  shouldUseMedicalDevelopmentStart(true, ""),
  false,
  "a normal local development run must start the complete game",
);
assert.equal(
  shouldUseMedicalDevelopmentStart(true, "?debugScene01=1"),
  false,
  "unrelated QA parameters must not enable the medical shortcut",
);
assert.equal(
  shouldUseMedicalDevelopmentStart(true, "?medicalDev=1"),
  true,
  "the medical shortcut must remain available when explicitly requested",
);
assert.equal(
  shouldUseMedicalDevelopmentStart(false, "?medicalDev=1"),
  false,
  "production must ignore development shortcuts",
);

console.log("Development start-mode contract verified.");
