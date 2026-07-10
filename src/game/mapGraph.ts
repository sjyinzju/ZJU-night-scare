import { campusRoads, type CampusRoad, type IsoPoint } from "./mapData";

export type RoadProjection = {
  point: IsoPoint;
  distance: number;
  roadId: string;
  segmentIndex: number;
  segmentStart: IsoPoint;
  segmentEnd: IsoPoint;
  direction: IsoPoint;
  length: number;
  t: number;
};

type RouteEdge = {
  to: number;
  distance: number;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const JUNCTION_CONNECT_DISTANCE = 0.36;

const normalize = (point: IsoPoint): IsoPoint => {
  const length = Math.hypot(point.x, point.y);
  if (length === 0) return { x: 0, y: 0 };
  return { x: point.x / length, y: point.y / length };
};

export class MapGraph {
  constructor(private readonly roads: CampusRoad[]) {}

  pointKey(point: IsoPoint) {
    return `${point.x.toFixed(3)},${point.y.toFixed(3)}`;
  }

  allRoadPoints() {
    const points: IsoPoint[] = [];
    const seen = new Set<string>();
    this.roads.forEach((road) => {
      road.points.forEach((point) => {
        const key = this.pointKey(point);
        if (!seen.has(key)) {
          seen.add(key);
          points.push(point);
        }
      });
    });
    return points;
  }

  nearestPoint(point: IsoPoint): { point: IsoPoint; distance: number } | null {
    const nearest = this.nearestProjection(point);
    if (!nearest) return null;
    return { point: nearest.point, distance: nearest.distance };
  }

  nearestProjection(point: IsoPoint): RoadProjection | null {
    let best: RoadProjection | null = null;
    for (const road of this.roads) {
      for (let index = 0; index < road.points.length - 1; index += 1) {
        const segmentStart = road.points[index];
        const segmentEnd = road.points[index + 1];
        const segmentVector = { x: segmentEnd.x - segmentStart.x, y: segmentEnd.y - segmentStart.y };
        const length = Math.hypot(segmentVector.x, segmentVector.y);
        if (length === 0) continue;

        const candidate = this.projectToSegment(point, segmentStart, segmentEnd);
        if (!best || candidate.distance < best.distance) {
          best = {
            ...candidate,
            roadId: road.id,
            segmentIndex: index,
            segmentStart,
            segmentEnd,
            direction: { x: segmentVector.x / length, y: segmentVector.y / length },
            length,
          };
        }
      }
    }
    return best;
  }

  availableDirections(point: IsoPoint, nearest: RoadProjection, junctionRadius: number) {
    const result: IsoPoint[] = [];
    const seen = new Set<string>();
    const add = (dir: IsoPoint) => {
      const normalized = normalize(dir);
      const key = `${normalized.x.toFixed(4)},${normalized.y.toFixed(4)}`;
      if (seen.has(key)) return;
      seen.add(key);
      result.push(normalized);
    };

    if (nearest.t < 0.98) add(nearest.direction);
    if (nearest.t > 0.02) add({ x: -nearest.direction.x, y: -nearest.direction.y });

    for (const road of this.roads) {
      for (const rp of road.points) {
        if (Math.hypot(point.x - rp.x, point.y - rp.y) > junctionRadius) continue;
        for (const other of this.roads) {
          for (let i = 0; i < other.points.length - 1; i += 1) {
            const a = other.points[i];
            const b = other.points[i + 1];
            if (Math.hypot(rp.x - a.x, rp.y - a.y) < 0.05) add({ x: b.x - a.x, y: b.y - a.y });
            if (Math.hypot(rp.x - b.x, rp.y - b.y) < 0.05) add({ x: a.x - b.x, y: a.y - b.y });
          }
        }
      }
    }

    return result;
  }

  routeLength(route: IsoPoint[]) {
    return route.reduce((total, point, index) => {
      if (index === 0) return 0;
      const previous = route[index - 1];
      return total + Math.hypot(point.x - previous.x, point.y - previous.y);
    }, 0);
  }

  findRoute(from: IsoPoint, to: IsoPoint) {
    const startProjection = this.nearestProjection(from);
    const endProjection = this.nearestProjection(to);
    if (!startProjection || !endProjection) return [from, to];

    const nodes: IsoPoint[] = [];
    const nodeByKey = new Map<string, number>();
    const edges = new Map<number, RouteEdge[]>();
    const addNode = (point: IsoPoint) => {
      const key = this.pointKey(point);
      const existing = nodeByKey.get(key);
      if (existing !== undefined) return existing;
      const index = nodes.length;
      nodes.push({ x: point.x, y: point.y });
      nodeByKey.set(key, index);
      edges.set(index, []);
      return index;
    };
    const connect = (a: number, b: number) => {
      const distance = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y);
      edges.get(a)!.push({ to: b, distance });
      edges.get(b)!.push({ to: a, distance });
    };

    this.roads.forEach((road) => {
      for (let index = 0; index < road.points.length - 1; index += 1) {
        const a = addNode(road.points[index]);
        const b = addNode(road.points[index + 1]);
        connect(a, b);
      }
    });

    for (let a = 0; a < nodes.length; a += 1) {
      for (let b = a + 1; b < nodes.length; b += 1) {
        const distance = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y);
        if (distance > 0 && distance <= JUNCTION_CONNECT_DISTANCE) connect(a, b);
      }
    }

    const addProjectionNode = (projection: RoadProjection) => {
      const projected = addNode(projection.point);
      const start = addNode(projection.segmentStart);
      const end = addNode(projection.segmentEnd);
      connect(projected, start);
      connect(projected, end);
      return projected;
    };

    const start = addProjectionNode(startProjection);
    const end = addProjectionNode(endProjection);
    if (startProjection.roadId === endProjection.roadId && startProjection.segmentIndex === endProjection.segmentIndex) {
      connect(start, end);
    }

    const distances = Array(nodes.length).fill(Number.POSITIVE_INFINITY);
    const previous = Array<number | undefined>(nodes.length).fill(undefined);
    const visited = new Set<number>();
    distances[start] = 0;

    while (visited.size < nodes.length) {
      let current = -1;
      let best = Number.POSITIVE_INFINITY;
      for (let index = 0; index < nodes.length; index += 1) {
        if (!visited.has(index) && distances[index] < best) {
          best = distances[index];
          current = index;
        }
      }
      if (current === -1 || current === end) break;
      visited.add(current);
      edges.get(current)!.forEach((edge) => {
        const next = distances[current] + edge.distance;
        if (next < distances[edge.to]) {
          distances[edge.to] = next;
          previous[edge.to] = current;
        }
      });
    }

    const route: IsoPoint[] = [];
    let cursor: number | undefined = end;
    while (cursor !== undefined) {
      route.push(nodes[cursor]);
      cursor = previous[cursor];
    }
    route.reverse();
    return route.length > 1 ? route : [startProjection.point, endProjection.point];
  }

  private projectToSegment(point: IsoPoint, a: IsoPoint, b: IsoPoint) {
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const wx = point.x - a.x;
    const wy = point.y - a.y;
    const lengthSq = vx * vx + vy * vy;
    if (lengthSq === 0) {
      return { point: a, distance: Math.hypot(point.x - a.x, point.y - a.y), t: 0 };
    }
    const t = clamp((wx * vx + wy * vy) / lengthSq, 0, 1);
    const projection = { x: a.x + t * vx, y: a.y + t * vy };
    return { point: projection, distance: Math.hypot(point.x - projection.x, point.y - projection.y), t };
  }
}

export const campusRoadGraph = new MapGraph(campusRoads);
