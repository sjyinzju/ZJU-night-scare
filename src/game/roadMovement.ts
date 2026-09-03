import type { IsoPoint } from "./mapData";

export interface IsometricRoadProjection {
  tileWidth: number;
  tileHeight: number;
  yStretch: number;
}

export interface RoadDirectionOption {
  direction: IsoPoint;
  screenDirection: IsoPoint;
}

const DIRECTION_MATCH_EPSILON = 0.005;
const DIRECTION_TIE_MARGIN = 0.02;
const DIRECT_INTENT_DOT = 0.995;
const GUIDE_COMPATIBILITY_DOT = 0.5;
const GUIDE_PRIORITY_MARGIN = 0.15;

export function normalizeRoadVector(point: IsoPoint): IsoPoint {
  const length = Math.hypot(point.x, point.y);
  if (length === 0) return { x: 0, y: 0 };
  return { x: point.x / length, y: point.y / length };
}

export function screenInputToIsoDirection(
  screen: IsoPoint,
  projection: IsometricRoadProjection,
): IsoPoint {
  return normalizeRoadVector({
    x: screen.x / projection.tileWidth + screen.y / projection.tileHeight,
    y: (screen.y / projection.tileHeight - screen.x / projection.tileWidth) / projection.yStretch,
  });
}

export function roadDirectionToScreen(
  direction: IsoPoint,
  projection: IsometricRoadProjection,
): IsoPoint {
  const visualY = direction.y * projection.yStretch;
  return normalizeRoadVector({
    x: (direction.x - visualY) * (projection.tileWidth / 2),
    y: (direction.x + visualY) * (projection.tileHeight / 2),
  });
}

function sameDirection(a: IsoPoint, b: IsoPoint): boolean {
  return Math.abs(a.x - b.x) < DIRECTION_MATCH_EPSILON
    && Math.abs(a.y - b.y) < DIRECTION_MATCH_EPSILON;
}

/**
 * Choose by the direction the player sees on screen. A decisive input always
 * wins. A compatible red-guide edge resolves ambiguous input before the prior
 * edge, which is retained only when neither signal distinguishes the branches.
 */
export function selectRoadDirection(
  input: IsoPoint,
  options: RoadDirectionOption[],
  lockedDirection: IsoPoint | null,
  guidedDirection: IsoPoint | null = null,
): RoadDirectionOption | undefined {
  if (options.length === 0) return undefined;
  const scores = options
    .map((option) => ({
      option,
      score: input.x * option.screenDirection.x + input.y * option.screenDirection.y,
    }))
    .sort((a, b) => {
      if (Math.abs(a.score - b.score) > Number.EPSILON) return b.score - a.score;
      const aAngle = Math.atan2(a.option.screenDirection.y, a.option.screenDirection.x);
      const bAngle = Math.atan2(b.option.screenDirection.y, b.option.screenDirection.x);
      return aAngle - bAngle;
    });
  const direct = scores.filter((candidate) => candidate.score >= DIRECT_INTENT_DOT);
  if (direct.length === 1) return direct[0].option;

  const best = scores[0];
  if (guidedDirection) {
    const guided = scores.find((candidate) => sameDirection(candidate.option.direction, guidedDirection));
    const inputSupportsGuide = guided
      && guided.score >= GUIDE_COMPATIBILITY_DOT
      && best.score - guided.score <= GUIDE_PRIORITY_MARGIN;
    if (inputSupportsGuide) return guided.option;
  }

  if (lockedDirection) {
    const locked = scores.find((candidate) => sameDirection(candidate.option.direction, lockedDirection));
    if (locked && best.score - locked.score <= DIRECTION_TIE_MARGIN) return locked.option;
  }
  return best.option;
}

/**
 * Resolve the red guide route's outgoing edge at one logical decision point.
 * The route must actually pass through the node and continue along one of its
 * authored directions; nearby or visually crossing routes are ignored.
 */
export function guideDirectionAtDecisionPoint(
  route: IsoPoint[],
  decisionPoint: IsoPoint,
  availableDirections: IsoPoint[],
  nodeTolerance = 0.05,
): IsoPoint | null {
  const nodeIndex = route.findIndex((point) => (
    Math.hypot(point.x - decisionPoint.x, point.y - decisionPoint.y) <= nodeTolerance
  ));
  if (nodeIndex < 0) return null;

  const nextPoint = route
    .slice(nodeIndex + 1)
    .find((point) => Math.hypot(point.x - decisionPoint.x, point.y - decisionPoint.y) > 0.0001);
  if (!nextPoint) return null;

  const routeDirection = normalizeRoadVector({
    x: nextPoint.x - decisionPoint.x,
    y: nextPoint.y - decisionPoint.y,
  });
  let bestDirection: IsoPoint | null = null;
  let bestDot = Number.NEGATIVE_INFINITY;
  for (const direction of availableDirections) {
    const normalized = normalizeRoadVector(direction);
    const dot = normalized.x * routeDirection.x + normalized.y * routeDirection.y;
    if (dot > bestDot) {
      bestDot = dot;
      bestDirection = normalized;
    }
  }
  return bestDot >= 0.995 ? bestDirection : null;
}

/**
 * Consume one movement step around a decision point.
 *
 * A branch choice may be queued while the player is still approaching the
 * node, but it must not pull the player sideways off the current edge. The
 * step therefore reaches the node first and spends only the remainder on the
 * selected outgoing edge. Selecting the edge the player is already standing
 * on means "go back" and moves directly away from the node.
 */
export function advanceRoadDirectionAtJunction(
  point: IsoPoint,
  stepDistance: number,
  junction: IsoPoint,
  selectedDirection: IsoPoint,
): IsoPoint {
  const toJunction = {
    x: junction.x - point.x,
    y: junction.y - point.y,
  };
  const distanceToJunction = Math.hypot(toJunction.x, toJunction.y);
  const direction = normalizeRoadVector(selectedDirection);

  if (distanceToJunction <= 0.0001) {
    return {
      x: junction.x + direction.x * stepDistance,
      y: junction.y + direction.y * stepDistance,
    };
  }

  const towardJunction = {
    x: toJunction.x / distanceToJunction,
    y: toJunction.y / distanceToJunction,
  };
  const outwardAlongCurrentEdge = {
    x: -towardJunction.x,
    y: -towardJunction.y,
  };
  const selectedCurrentEdge =
    direction.x * outwardAlongCurrentEdge.x + direction.y * outwardAlongCurrentEdge.y >= 0.995;

  if (selectedCurrentEdge) {
    return {
      x: point.x + direction.x * stepDistance,
      y: point.y + direction.y * stepDistance,
    };
  }

  if (stepDistance <= distanceToJunction) {
    return {
      x: point.x + towardJunction.x * stepDistance,
      y: point.y + towardJunction.y * stepDistance,
    };
  }

  const remainingDistance = stepDistance - distanceToJunction;
  return {
    x: junction.x + direction.x * remainingDistance,
    y: junction.y + direction.y * remainingDistance,
  };
}
