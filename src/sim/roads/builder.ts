import { ROAD_RULES, ROAD_TYPES, type RoadTypeId } from '../../config/roads';
import { WORLD } from '../../config/settings';
import { distance, dot, type Vec2 } from '../../util/vec2';
import {
  intersect,
  minRadius,
  nearBounds,
  paramAt,
  pointAt,
  project,
  samplePath,
  subControl,
  tangentAt,
  type Polyline,
} from './geometry';
import {
  addNode,
  addSegment,
  directionFrom,
  mergeStraightJoint,
  nodeOf,
  segmentOf,
  shapeOf,
  splitSegment,
  type RoadNetwork,
  type RoadSegment,
} from './graph';

export interface RoadRequest {
  start: Vec2;
  end: Vec2;
  /** Kontrollpunkt für eine Kurve; fehlt bei einer Geraden. */
  control?: Vec2;
  type: RoadTypeId;
}

export type RoadProblem =
  | 'tooShort'
  | 'tooSharp'
  | 'outOfBounds'
  | 'tooCloseToJunction'
  | 'angleTooSmall'
  | 'overlap';

/** Stelle auf der neuen Straße, an der ein Knoten liegt oder entsteht. */
export interface Anchor {
  /** Strecke entlang der neuen Straße und der zugehörige Kurvenparameter. */
  distance: number;
  t: number;
  point: Vec2;
  /** Vorhandener Knoten, falls die Stelle auf einem liegt. */
  node?: number;
  /** Vorhandenes Segment, das an dieser Stelle geteilt wird. */
  split?: { segment: number; distance: number };
}

export interface RoadPlan {
  request: RoadRequest;
  /** Mittellinie der neuen Straße, zum Beispiel für die Vorschau. */
  shape: Polyline;
  anchors: Anchor[];
  /** Grund, warum die Straße so nicht gebaut werden kann; sonst null. */
  problem: RoadProblem | null;
}

/** Treffer so nah an einem angeschlossenen Ende gehören zu diesem Ende und sind keine eigene Kreuzung. */
const ENDPOINT_MERGE = 4;
const OVERLAP_STEP = 4;
/** Spielraum in Metern, damit sich berührende Straßen nicht als Überlappung zählen. */
const OVERLAP_SLACK = 0.5;
/** Zwei Arme eines Knotens gelten als dieselbe durchlaufende Straße, wenn sie höchstens rund 30° abknicken. */
const CONTINUES_DOT = -0.85;

/** Prüft, ob und wie sich die gewünschte Straße ins Netz einfügt. Ändert das Netz nicht. */
export function planRoad(net: RoadNetwork, request: RoadRequest): RoadPlan {
  const shape = samplePath(request.start, request.end, request.control);
  const plan: RoadPlan = { request, shape, anchors: [], problem: null };
  plan.problem = check(net, plan);
  return plan;
}

/** Baut eine geplante Straße. Das Netz darf seit `planRoad` nicht verändert worden sein. */
export function commitRoad(net: RoadNetwork, plan: RoadPlan): RoadSegment[] {
  if (plan.problem) throw new Error(`Straße kann nicht gebaut werden: ${plan.problem}`);
  const { anchors, request } = plan;

  const nodeIds: number[] = [];
  const splits = new Map<number, { index: number; distance: number }[]>();
  anchors.forEach((anchor, index) => {
    if (anchor.node !== undefined) {
      nodeIds[index] = anchor.node;
    } else if (anchor.split) {
      const list = splits.get(anchor.split.segment) ?? [];
      list.push({ index, distance: anchor.split.distance });
      splits.set(anchor.split.segment, list);
    } else {
      nodeIds[index] = addNode(net, anchor.point).id;
    }
  });

  // Von hinten nach vorn teilen: so bleiben die Strecken im vorderen Teilstück gültig.
  for (const [segmentId, list] of splits) {
    list.sort((a, b) => b.distance - a.distance);
    let remaining = segmentId;
    for (const split of list) {
      const result = splitSegment(net, remaining, split.distance);
      nodeIds[split.index] = result.node.id;
      remaining = result.first.id;
    }
  }

  const created: RoadSegment[] = [];
  for (let i = 0; i + 1 < anchors.length; i++) {
    const control =
      request.control &&
      subControl(request.start, request.control, request.end, anchors[i].t, anchors[i + 1].t);
    created.push(addSegment(net, nodeIds[i], nodeIds[i + 1], request.type, control));
  }

  // Setzt die neue Straße eine vorhandene geradlinig fort, verschmelzen beide zu einem Stück.
  for (const nodeId of nodeIds) {
    const merged = mergeStraightJoint(net, nodeId);
    if (merged) created.push(merged);
  }
  return created.filter((segment) => net.segments.has(segment.id));
}

function check(net: RoadNetwork, plan: RoadPlan): RoadProblem | null {
  const { request, shape } = plan;
  if (shape.length < ROAD_RULES.minLength) return 'tooShort';
  if (request.control) {
    if (minRadius(request.start, request.control, request.end) < ROAD_RULES.minRadius) return 'tooSharp';
  }
  const half = WORLD.size / 2;
  if (shape.minX < -half || shape.maxX > half || shape.minZ < -half || shape.maxZ > half) {
    return 'outOfBounds';
  }

  const start = endpointAnchor(net, shape, 0);
  const end = endpointAnchor(net, shape, shape.length);
  if (!start || !end) return 'tooCloseToJunction';
  const found: Anchor[] = [start, end];

  for (const segment of net.segments.values()) {
    const other = shapeOf(net, segment);
    for (const hit of intersect(shape, other)) {
      if (isAtEndpoint(hit.point, segment, start) || isAtEndpoint(hit.point, segment, end)) continue;
      const anchor: Anchor = {
        distance: hit.distanceA,
        t: paramAt(shape, hit.distanceA),
        point: hit.point,
      };
      const endNode = [segment.from, segment.to].find(
        (id) => distance(nodeOf(net, id), hit.point) <= ROAD_RULES.snapTolerance,
      );
      if (endNode !== undefined) {
        anchor.node = endNode;
      } else if (
        hit.distanceB < ROAD_RULES.minSpacing ||
        other.length - hit.distanceB < ROAD_RULES.minSpacing
      ) {
        return 'tooCloseToJunction';
      } else {
        anchor.split = { segment: segment.id, distance: hit.distanceB };
      }
      found.push(anchor);
    }
  }

  found.sort((a, b) => a.distance - b.distance);
  const anchors = plan.anchors;
  for (const anchor of found) {
    const previous = anchors[anchors.length - 1];
    // Mehrere Arme derselben Kreuzung liefern denselben Knoten mehrfach.
    if (previous && previous.node !== undefined && previous.node === anchor.node) continue;
    if (previous && anchor.distance - previous.distance < ROAD_RULES.minSpacing) return 'tooCloseToJunction';
    anchors.push(anchor);
  }
  if (anchors.length < 2) return 'tooShort';

  // Kreuzt die neue Straße dasselbe vorhandene Stück mehrfach, brauchen die Kreuzungen auch dort Abstand.
  const splits = new Map<number, number[]>();
  for (const anchor of anchors) {
    if (!anchor.split) continue;
    const others = splits.get(anchor.split.segment) ?? [];
    if (others.some((other) => Math.abs(other - anchor.split!.distance) < ROAD_RULES.minSpacing)) {
      return 'tooCloseToJunction';
    }
    others.push(anchor.split.distance);
    splits.set(anchor.split.segment, others);
  }

  if (hasSharpJunction(net, shape, anchors)) return 'angleTooSmall';
  if (overlapsOtherRoad(net, request.type, shape, anchors)) return 'overlap';
  return null;
}

/** Bestimmt, woran ein Ende der neuen Straße anschließt. Null: zu nah an einer bestehenden Kreuzung. */
function endpointAnchor(net: RoadNetwork, shape: Polyline, dist: number): Anchor | null {
  const point = pointAt(shape, dist);
  const anchor: Anchor = { distance: dist, t: dist === 0 ? 0 : 1, point };

  let nearest = ROAD_RULES.snapTolerance;
  for (const node of net.nodes.values()) {
    const gap = distance(node, point);
    if (gap <= nearest) {
      nearest = gap;
      anchor.node = node.id;
    }
  }
  if (anchor.node !== undefined) return anchor;

  let closest = ROAD_RULES.snapTolerance;
  let splitLength = 0;
  for (const segment of net.segments.values()) {
    const other = shapeOf(net, segment);
    if (!nearBounds(other, point, closest)) continue;
    const hit = project(other, point);
    if (hit.offset <= closest) {
      closest = hit.offset;
      splitLength = other.length;
      anchor.split = { segment: segment.id, distance: hit.distance };
    }
  }
  if (anchor.split) {
    const fromStart = anchor.split.distance;
    if (fromStart < ROAD_RULES.minSpacing || splitLength - fromStart < ROAD_RULES.minSpacing) return null;
  }
  return anchor;
}

function isAtEndpoint(point: Vec2, segment: RoadSegment, endpoint: Anchor): boolean {
  if (distance(point, endpoint.point) > ENDPOINT_MERGE) return false;
  if (endpoint.split) return endpoint.split.segment === segment.id;
  return endpoint.node !== undefined && (segment.from === endpoint.node || segment.to === endpoint.node);
}

/** Trifft die neue Straße an einem Anschluss in zu spitzem Winkel auf eine vorhandene? */
function hasSharpJunction(net: RoadNetwork, shape: Polyline, anchors: Anchor[]): boolean {
  const minDot = Math.cos((ROAD_RULES.minAngle * Math.PI) / 180);
  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    const arms: Vec2[] = [];
    if (anchor.node !== undefined) {
      for (const id of nodeOf(net, anchor.node).segments) {
        arms.push(directionFrom(net, segmentOf(net, id), anchor.node));
      }
    } else if (anchor.split) {
      const along = tangentAt(shapeOf(net, segmentOf(net, anchor.split.segment)), anchor.split.distance);
      arms.push(along, { x: -along.x, z: -along.z });
    }

    // Die neue Straße verlässt den Anschluss nach vorn, nach hinten oder in beide Richtungen.
    const tangent = tangentAt(shape, anchor.distance);
    const leavesForward = i < anchors.length - 1;
    const leavesBackward = i > 0;
    for (const arm of arms) {
      const alignment = dot(arm, tangent);
      if ((leavesForward && alignment > minDot) || (leavesBackward && -alignment > minDot)) return true;
    }
  }
  return false;
}

/**
 * Liegt die neue Straße auf oder zu dicht neben einer anderen, ohne an sie anzuschließen?
 * Nur den Straßen, die an einem Anschluss beteiligt sind, darf sie dort so nah kommen,
 * wie es der kleinste erlaubte Winkel ergibt; zu allen anderen hält sie vollen Abstand.
 */
function overlapsOtherRoad(
  net: RoadNetwork,
  type: RoadTypeId,
  shape: Polyline,
  anchors: Anchor[],
): boolean {
  const halfWidth = ROAD_TYPES[type].width / 2;
  const wedge = Math.sin((ROAD_RULES.minAngle * Math.PI) / 180);
  const connections = anchors
    .filter((anchor) => anchor.node !== undefined || anchor.split)
    .map((anchor) => ({ distance: anchor.distance, segments: joinedSegments(net, anchor) }));

  const steps = Math.ceil(shape.length / OVERLAP_STEP);
  for (let i = 0; i <= steps; i++) {
    const dist = (i / steps) * shape.length;
    const point = pointAt(shape, dist);
    for (const segment of net.segments.values()) {
      const other = shapeOf(net, segment);
      const clearance = halfWidth + ROAD_TYPES[segment.type].width / 2;
      if (!nearBounds(other, point, clearance)) continue;
      let toConnection = Infinity;
      for (const connection of connections) {
        if (connection.segments.has(segment.id)) {
          toConnection = Math.min(toConnection, Math.abs(connection.distance - dist));
        }
      }
      const allowed = Math.min(clearance, toConnection * wedge) - OVERLAP_SLACK;
      if (allowed > 0 && project(other, point).offset < allowed) return true;
    }
  }
  return false;
}

/**
 * Segmente, die an einem Anschluss beteiligt sind: die Arme des Knotens bzw. das geteilte Segment,
 * dazu alles, was eines davon an seinem anderen Ende in gleicher Richtung fortsetzt (dieselbe Straße).
 */
function joinedSegments(net: RoadNetwork, anchor: Anchor): Set<number> {
  const direct =
    anchor.node !== undefined
      ? nodeOf(net, anchor.node).segments
      : anchor.split
        ? [anchor.split.segment]
        : [];
  const joined = new Set(direct);
  for (const id of direct) {
    const segment = segmentOf(net, id);
    for (const nodeId of [segment.from, segment.to]) {
      const here = directionFrom(net, segment, nodeId);
      for (const nextId of nodeOf(net, nodeId).segments) {
        if (dot(here, directionFrom(net, segmentOf(net, nextId), nodeId)) < CONTINUES_DOT) joined.add(nextId);
      }
    }
  }
  return joined;
}
