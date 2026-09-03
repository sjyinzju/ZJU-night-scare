import assert from "node:assert/strict";
import { campusRoads, type IsoPoint } from "../src/game/mapData";
import { MapGraph } from "../src/game/mapGraph";
import {
  advanceRoadDirectionAtJunction,
  guideDirectionAtDecisionPoint,
  normalizeRoadVector,
  roadDirectionToScreen,
  screenInputToIsoDirection,
  selectRoadDirection,
  type RoadDirectionOption,
} from "../src/game/roadMovement";

const projection = { tileWidth: 112, tileHeight: 50, yStretch: 1.18 } as const;
const graph = new MapGraph(campusRoads);
const closeTo = (actual: number, expected: number, message: string) => {
  assert.ok(Math.abs(actual - expected) < 0.0001, `${message}: expected ${expected}, received ${actual}`);
};
const sameDirection = (a: IsoPoint, b: IsoPoint) => (
  Math.abs(a.x - b.x) < 0.0001 && Math.abs(a.y - b.y) < 0.0001
);
const optionsFor = (directions: IsoPoint[]): RoadDirectionOption[] => directions.map((direction) => ({
  direction,
  screenDirection: roadDirectionToScreen(direction, projection),
}));
const keyboardDirections = [
  { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
  { x: -1, y: 0 },                       { x: 1, y: 0 },
  { x: -1, y: 1 },  { x: 0, y: 1 },  { x: 1, y: 1 },
].map(normalizeRoadVector);

for (const keyboardDirection of keyboardDirections) {
  const roundTrip = roadDirectionToScreen(
    screenInputToIsoDirection(keyboardDirection, projection),
    projection,
  );
  assert.ok(
    keyboardDirection.x * roundTrip.x + keyboardDirection.y * roundTrip.y > 0.9999,
    "screen input and road projection must use the same coordinate contract",
  );
}

// Real campus fork: approach the theater junction from the lower-left screen
// branch, then request the lower-right screen branch before reaching the node.
const fork = { x: 10.2, y: 11.6 };
const approach = { x: 10.2, y: 12.5 };
const roadProjection = graph.nearestProjection(approach);
assert.ok(roadProjection, "the real theater approach must project onto a road");
const junction = graph.nearestDecisionPointOnProjection(approach, roadProjection, 1.2);
assert.ok(junction, "the real theater fork must be detected before the exact node");
closeTo(junction.point.x, fork.x, "junction x");
closeTo(junction.point.y, fork.y, "junction y");

const directions = optionsFor(junction.directions);
const routeToTheater = graph.findRoute(approach, { x: 12.1, y: 11.6 });
const guideDirection = guideDirectionAtDecisionPoint(routeToTheater, junction.point, junction.directions);
assert.ok(
  guideDirection && sameDirection(guideDirection, { x: 1, y: 0 }),
  "the theater red route must resolve to the junction's lower-right outgoing edge",
);
assert.equal(
  guideDirectionAtDecisionPoint([{ x: 20, y: 20 }, { x: 21, y: 20 }], junction.point, junction.directions),
  null,
  "a route that does not pass through the decision point must not influence movement",
);
const rightDown = normalizeRoadVector({ x: 1, y: 1 });
const selected = selectRoadDirection(rightDown, directions, { x: 0, y: -1 });
assert.ok(selected, "right-down must select a branch");
assert.ok(sameDirection(selected.direction, { x: 1, y: 0 }), "right-down must select the visible lower-right branch");

let position = approach;
position = advanceRoadDirectionAtJunction(position, 0.28, junction.point, selected.direction);
closeTo(position.x, approach.x, "a queued turn must stay on the approach road");
assert.ok(position.y < approach.y, "a queued turn must continue toward the junction");
for (let step = 0; step < 3; step += 1) {
  position = advanceRoadDirectionAtJunction(position, 0.28, junction.point, selected.direction);
}
assert.ok(position.x > fork.x, "the queued turn must continue onto the selected branch after crossing the node");
closeTo(position.y, fork.y, "the selected branch must not drift off its road");

// A horizontal key alone cannot distinguish the symmetric upper/lower-right
// branches, so continuity is the only non-arbitrary answer.
const rightOnly = { x: 1, y: 0 };
const lockedUpperRight = selectRoadDirection(rightOnly, directions, { x: 0, y: -1 });
assert.ok(lockedUpperRight && sameDirection(lockedUpperRight.direction, { x: 0, y: -1 }));
const guidedLowerRight = selectRoadDirection(
  rightOnly,
  directions,
  { x: 0, y: -1 },
  guideDirection,
);
assert.ok(
  guidedLowerRight && sameDirection(guidedLowerRight.direction, { x: 1, y: 0 }),
  "an input compatible with the red guide must prefer its lower-right branch",
);
const upperRightDirection = directions.find((option) => sameDirection(option.direction, { x: 0, y: -1 }));
assert.ok(upperRightDirection);
const explicitUpperRight = selectRoadDirection(
  upperRightDirection.screenDirection,
  directions,
  { x: 1, y: 0 },
  guideDirection,
);
assert.ok(
  explicitUpperRight && sameDirection(explicitUpperRight.direction, { x: 0, y: -1 }),
  "the red guide must not override an explicit input toward another branch",
);
const unlockedRight = selectRoadDirection(rightOnly, directions, null);
const reversedUnlockedRight = selectRoadDirection(rightOnly, [...directions].reverse(), null);
assert.ok(unlockedRight && reversedUnlockedRight);
assert.ok(
  sameDirection(unlockedRight.direction, reversedUnlockedRight.direction),
  "an ambiguous input without history must not depend on candidate array order",
);

// Every authored branch must remain selectable when input points directly at
// its rendered screen direction, regardless of the previously locked edge.
let authoredJunctions = 0;
let authoredBranches = 0;
for (const point of graph.allRoadPoints()) {
  const junctionDirections = graph.directionsAt(point);
  if (junctionDirections.length < 3) continue;
  authoredJunctions += 1;
  const junctionOptions = optionsFor(junctionDirections);
  for (let index = 0; index < junctionOptions.length; index += 1) {
    authoredBranches += 1;
    const target = junctionOptions[index];
    const prior = junctionOptions[(index + 1) % junctionOptions.length].direction;
    const result = selectRoadDirection(target.screenDirection, junctionOptions, prior);
    assert.ok(result && sameDirection(result.direction, target.direction), `branch ${index} at ${point.x},${point.y} is unreachable`);

    const keyboardCanSelectBranch = keyboardDirections.some((input) => (
      junctionOptions.every((priorOption) => {
        const keyboardResult = selectRoadDirection(input, junctionOptions, priorOption.direction);
        return keyboardResult && sameDirection(keyboardResult.direction, target.direction);
      })
    ));
    assert.ok(
      keyboardCanSelectBranch,
      `branch ${index} at ${point.x},${point.y} cannot override prior movement with any keyboard direction`,
    );
  }
}

console.log(
  `Exterior road movement contract verified (${authoredJunctions} junctions, ${authoredBranches} outgoing branches).`,
);
