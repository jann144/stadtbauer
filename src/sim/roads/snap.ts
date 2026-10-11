import { ROAD_RULES, ROAD_TYPES } from '../../config/roads';
import { distance, type Vec2 } from '../../util/vec2';
import { nearBounds, project, tangentAt } from './geometry';
import { directionFrom, nodeOf, segmentOf, shapeOf, type RoadNetwork } from './graph';

/** Ergebnis des Einrastens: der Punkt und woran er hängt (Knoten, Segment oder nichts). */
export interface Snap {
  point: Vec2;
  node?: number;
  segment?: number;
}

/** Rastet einen Punkt am nächsten Knoten oder an der nächsten Straße innerhalb von `radius` ein. */
export function snapToNetwork(net: RoadNetwork, raw: Vec2, radius: number): Snap {
  let best: Snap = { point: raw };
  let nearest = radius;
  for (const node of net.nodes.values()) {
    const gap = distance(node, raw);
    if (gap <= nearest) {
      nearest = gap;
      best = { point: { x: node.x, z: node.z }, node: node.id };
    }
  }
  if (best.node !== undefined) return best;

  for (const segment of net.segments.values()) {
    const shape = shapeOf(net, segment);
    if (!nearBounds(shape, raw, nearest)) continue;
    const hit = project(shape, raw);
    if (hit.offset > nearest) continue;
    nearest = hit.offset;

    // Dicht am Ende eines Segments gleich dessen Knoten nehmen, sonst entstünde ein zu kurzes Stück.
    let end: number | undefined;
    if (hit.distance < ROAD_RULES.minSpacing) end = segment.from;
    else if (shape.length - hit.distance < ROAD_RULES.minSpacing) end = segment.to;
    if (end === undefined) {
      best = { point: hit.point, segment: segment.id };
    } else {
      const node = nodeOf(net, end);
      best = { point: { x: node.x, z: node.z }, node: end };
    }
  }
  return best;
}

/** Richtung der Straße an einer eingerasteten Stelle als Winkel in der Bodenebene; 0 abseits des Netzes. */
export function roadAngleAt(net: RoadNetwork, snap: Snap): number {
  if (snap.node !== undefined) {
    const first = nodeOf(net, snap.node).segments[0];
    if (first === undefined) return 0;
    const direction = directionFrom(net, segmentOf(net, first), snap.node);
    return Math.atan2(direction.z, direction.x);
  }
  if (snap.segment !== undefined) {
    const shape = shapeOf(net, segmentOf(net, snap.segment));
    const direction = tangentAt(shape, project(shape, snap.point).distance);
    return Math.atan2(direction.z, direction.x);
  }
  return 0;
}

/** Id des Segments unter einem Punkt (innerhalb der Straßenbreite plus `margin`), oder null. */
export function pickSegment(net: RoadNetwork, point: Vec2, margin: number): number | null {
  let best: number | null = null;
  let nearest = Infinity;
  for (const segment of net.segments.values()) {
    const shape = shapeOf(net, segment);
    const reach = ROAD_TYPES[segment.type].width / 2 + margin;
    if (!nearBounds(shape, point, reach)) continue;
    const offset = project(shape, point).offset;
    if (offset <= reach && offset < nearest) {
      nearest = offset;
      best = segment.id;
    }
  }
  return best;
}
