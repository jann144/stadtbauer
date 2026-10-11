import { ROAD_TYPES } from '../../config/roads';
import type { Vec2 } from '../../util/vec2';
import type { Lot } from '../buildings';
import { nearBounds, project } from '../roads/geometry';
import { nodeOf, segmentOf, shapeOf, type RoadNetwork, type RoadSegment } from '../roads/graph';
import type { World } from '../world';
import type { ZoneGrid } from '../zoning/cells';

/** Stelle auf dem Straßennetz: ein Segment und die Strecke von dessen Anfang. */
export interface Access {
  segment: number;
  distance: number;
}

/** Ein Abschnitt eines Segments, von `from` bis `to` Metern ab dessen Anfang. */
export interface Stretch {
  segment: RoadSegment;
  from: number;
  to: number;
}

/** So weit neben dem Straßenrand darf ein Punkt liegen, um noch als Anlieger zu gelten. */
const ACCESS_MARGIN = 3;

/** Nächste Stelle des Straßennetzes zu einem Punkt am Straßenrand, oder null, wenn dort keine Straße liegt. */
export function accessOf(net: RoadNetwork, point: Vec2): Access | null {
  let best: Access | null = null;
  let nearest = Infinity;
  for (const segment of net.segments.values()) {
    const line = shapeOf(net, segment);
    const reach = ROAD_TYPES[segment.type].width / 2 + ACCESS_MARGIN;
    if (!nearBounds(line, point, reach)) continue;
    const hit = project(line, point);
    if (hit.offset <= reach && hit.offset < nearest) {
      nearest = hit.offset;
      best = { segment: segment.id, distance: hit.distance };
    }
  }
  return best;
}

/** Anschluss jedes Grundstücks; gilt, solange das Zellraster (und damit das Straßennetz) dasselbe ist. */
const accessCache = new WeakMap<ZoneGrid, Map<number, Access | null>>();

/** Stelle des Straßennetzes, an der ein Grundstück anliegt; null, wenn dort keine Straße (mehr) ist. */
export function lotAccess(world: World, lot: Lot): Access | null {
  let known = accessCache.get(world.zoning);
  if (!known) accessCache.set(world.zoning, (known = new Map()));
  let access = known.get(lot.id);
  if (access === undefined) {
    access = accessOf(world.roads, { x: lot.frontX, z: lot.frontZ });
    known.set(lot.id, access);
  }
  return access;
}

/** Nummer des zusammenhängenden Teilnetzes je Knoten. Straßen ohne Verbindung haben verschiedene Nummern. */
export function roadComponents(net: RoadNetwork): Map<number, number> {
  const component = new Map<number, number>();
  let next = 0;
  for (const start of net.nodes.keys()) {
    if (component.has(start)) continue;
    const id = next++;
    const open = [start];
    component.set(start, id);
    while (open.length > 0) {
      const nodeId = open.pop()!;
      for (const segmentId of nodeOf(net, nodeId).segments) {
        const segment = segmentOf(net, segmentId);
        const other = segment.from === nodeId ? segment.to : segment.from;
        if (component.has(other)) continue;
        component.set(other, id);
        open.push(other);
      }
    }
  }
  return component;
}

/** Wegstrecke entlang der Straßen von einer Stelle zu allen Knoten, die höchstens `range` Meter entfernt sind. */
export function reachFrom(net: RoadNetwork, from: Access, range: number): Map<number, number> {
  const distances = new Map<number, number>();
  const start = net.segments.get(from.segment);
  if (!start) return distances;
  const open = [
    { node: start.from, distance: from.distance },
    { node: start.to, distance: shapeOf(net, start).length - from.distance },
  ];
  while (open.length > 0) {
    // Immer den nächstgelegenen offenen Knoten zuerst; die Listen bleiben klein, weil die Reichweite begrenzt ist.
    let pick = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].distance < open[pick].distance) pick = i;
    }
    const { node, distance } = open.splice(pick, 1)[0];
    if (distance > range || (distances.get(node) ?? Infinity) <= distance) continue;
    distances.set(node, distance);
    for (const segmentId of nodeOf(net, node).segments) {
      const segment = segmentOf(net, segmentId);
      const other = segment.from === node ? segment.to : segment.from;
      const beyond = distance + shapeOf(net, segment).length;
      if (beyond <= range && beyond < (distances.get(other) ?? Infinity)) open.push({ node: other, distance: beyond });
    }
  }
  return distances;
}

/** Wegstrecke von der Ausgangsstelle (mit ihren Knotenentfernungen aus `reachFrom`) zu einer anderen Stelle. */
export function roadDistance(net: RoadNetwork, from: Access, reach: Map<number, number>, to: Access): number {
  const segment = net.segments.get(to.segment);
  if (!segment) return Infinity;
  const length = shapeOf(net, segment).length;
  let best = Math.min(
    (reach.get(segment.from) ?? Infinity) + to.distance,
    (reach.get(segment.to) ?? Infinity) + length - to.distance,
  );
  if (to.segment === from.segment) best = Math.min(best, Math.abs(to.distance - from.distance));
  return best;
}

/** Alle Straßenabschnitte, die höchstens `range` Meter Weg von der Ausgangsstelle entfernt sind. */
export function reachedStretches(net: RoadNetwork, from: Access, range: number): Stretch[] {
  const reach = reachFrom(net, from, range);
  const stretches: Stretch[] = [];
  for (const segment of net.segments.values()) {
    const length = shapeOf(net, segment).length;
    const parts: [number, number][] = [];
    // Von jedem erreichten Ende her so weit ins Segment hinein, wie die Reichweite noch trägt.
    const fromStart = reach.get(segment.from);
    if (fromStart !== undefined) parts.push([0, Math.min(length, range - fromStart)]);
    const fromEnd = reach.get(segment.to);
    if (fromEnd !== undefined) parts.push([Math.max(0, length - (range - fromEnd)), length]);
    if (segment.id === from.segment) {
      parts.push([Math.max(0, from.distance - range), Math.min(length, from.distance + range)]);
    }

    // Überlappende Teile zusammenfassen.
    parts.sort((a, b) => a[0] - b[0]);
    let current: [number, number] | null = null;
    for (const part of parts) {
      if (current && part[0] <= current[1]) {
        current[1] = Math.max(current[1], part[1]);
        continue;
      }
      if (current) stretches.push({ segment, from: current[0], to: current[1] });
      current = [part[0], part[1]];
    }
    if (current) stretches.push({ segment, from: current[0], to: current[1] });
  }
  return stretches;
}
