import type { RoadTypeId } from '../../config/roads';
import { lerp, normalize, sub, type Vec2 } from '../../util/vec2';
import { bezierPoint, paramAt, samplePath, type Polyline } from './geometry';

export interface RoadNode {
  id: number;
  x: number;
  z: number;
  /** Ids der Segmente, die an diesem Knoten enden. */
  segments: number[];
}

export interface RoadSegment {
  id: number;
  /** Ids des Anfangs- und Endknotens. */
  from: number;
  to: number;
  /** Kontrollpunkt der quadratischen Bézier-Kurve; fehlt bei geraden Stücken. */
  control?: Vec2;
  type: RoadTypeId;
  /**
   * Reihenfolge der Entstehung; bleibt beim Teilen und Zusammenlegen erhalten.
   * Wo sich Bauland zweier Straßen überschneidet, hat die ältere Vorrang.
   */
  age: number;
}

/** Straßennetz als Graph. Knoten und Segmente werden nach dem Anlegen nicht mehr verändert, nur ersetzt. */
export interface RoadNetwork {
  nodes: Map<number, RoadNode>;
  segments: Map<number, RoadSegment>;
  nextId: number;
}

const shapes = new WeakMap<RoadSegment, Polyline>();

export function createNetwork(): RoadNetwork {
  return { nodes: new Map(), segments: new Map(), nextId: 1 };
}

export function nodeOf(net: RoadNetwork, id: number): RoadNode {
  const node = net.nodes.get(id);
  if (!node) throw new Error(`Straßenknoten ${id} fehlt`);
  return node;
}

export function segmentOf(net: RoadNetwork, id: number): RoadSegment {
  const segment = net.segments.get(id);
  if (!segment) throw new Error(`Straßensegment ${id} fehlt`);
  return segment;
}

export function addNode(net: RoadNetwork, at: Vec2): RoadNode {
  const node: RoadNode = { id: net.nextId++, x: at.x, z: at.z, segments: [] };
  net.nodes.set(node.id, node);
  return node;
}

export function addSegment(
  net: RoadNetwork,
  from: number,
  to: number,
  type: RoadTypeId,
  control?: Vec2,
  age?: number,
): RoadSegment {
  const id = net.nextId++;
  const segment: RoadSegment = { id, from, to, type, age: age ?? id };
  if (control) segment.control = { x: control.x, z: control.z };
  net.segments.set(segment.id, segment);
  nodeOf(net, from).segments.push(segment.id);
  nodeOf(net, to).segments.push(segment.id);
  return segment;
}

/** Entfernt ein Segment und Knoten, an denen danach keine Straße mehr endet. */
export function removeSegment(net: RoadNetwork, id: number): void {
  const segment = net.segments.get(id);
  if (!segment) return;
  detach(net, segment);
  for (const nodeId of [segment.from, segment.to]) {
    if (net.nodes.get(nodeId)?.segments.length === 0) net.nodes.delete(nodeId);
    else mergeStraightJoint(net, nodeId);
  }
}

/**
 * Löst einen Knoten auf, an dem nur zwei gerade Stücke desselben Typs in einer Linie aufeinandertreffen,
 * und macht daraus ein Stück. Solche Nahtstellen entstehen beim Weiterbauen und beim Abreißen von
 * Seitenstraßen; sie wären unsichtbar, würden aber Kreuzungen in ihrer Nähe verhindern.
 * Liefert das neue Stück oder null, wenn nichts zusammenzulegen war.
 */
export function mergeStraightJoint(net: RoadNetwork, nodeId: number): RoadSegment | null {
  const node = net.nodes.get(nodeId);
  if (!node || node.segments.length !== 2) return null;
  const first = segmentOf(net, node.segments[0]);
  const second = segmentOf(net, node.segments[1]);
  if (first.control || second.control || first.type !== second.type) return null;

  const start = nodeOf(net, first.from === nodeId ? first.to : first.from);
  const end = nodeOf(net, second.from === nodeId ? second.to : second.from);
  if (start.id === end.id || start.id === nodeId || end.id === nodeId) return null;
  // Der Knoten muss zwischen den beiden Enden und praktisch auf ihrer Verbindungslinie liegen.
  const span = sub(end, start);
  const toNode = sub(node, start);
  const length = Math.hypot(span.x, span.z);
  const along = (toNode.x * span.x + toNode.z * span.z) / length;
  const aside = Math.abs(toNode.x * span.z - toNode.z * span.x) / length;
  if (along <= 0 || along >= length || aside > 0.05) return null;

  detach(net, first);
  detach(net, second);
  net.nodes.delete(nodeId);
  return addSegment(net, start.id, end.id, first.type, undefined, Math.min(first.age, second.age));
}

function detach(net: RoadNetwork, segment: RoadSegment): void {
  net.segments.delete(segment.id);
  for (const nodeId of [segment.from, segment.to]) {
    const node = nodeOf(net, nodeId);
    node.segments = node.segments.filter((other) => other !== segment.id);
  }
}

/** Abgetastete Mittellinie eines Segments, von `from` nach `to`. */
export function shapeOf(net: RoadNetwork, segment: RoadSegment): Polyline {
  let shape = shapes.get(segment);
  if (!shape) {
    shape = samplePath(nodeOf(net, segment.from), nodeOf(net, segment.to), segment.control);
    shapes.set(segment, shape);
  }
  return shape;
}

/** Einheitsvektor, der vom Knoten weg entlang des Segments zeigt. */
export function directionFrom(net: RoadNetwork, segment: RoadSegment, nodeId: number): Vec2 {
  const here = nodeOf(net, nodeId);
  const there = nodeOf(net, nodeId === segment.from ? segment.to : segment.from);
  return normalize(sub(segment.control ?? there, here));
}

/** Teilt ein Segment nach `distance` Metern und setzt dort einen neuen Knoten. */
export function splitSegment(
  net: RoadNetwork,
  id: number,
  distance: number,
): { node: RoadNode; first: RoadSegment; second: RoadSegment } {
  const segment = segmentOf(net, id);
  const a = nodeOf(net, segment.from);
  const b = nodeOf(net, segment.to);
  const control = segment.control;
  const t = paramAt(shapeOf(net, segment), distance);

  const node = addNode(net, control ? bezierPoint(a, control, b, t) : lerp(a, b, t));
  detach(net, segment);
  const first = addSegment(net, segment.from, node.id, segment.type, control && lerp(a, control, t), segment.age);
  const second = addSegment(net, node.id, segment.to, segment.type, control && lerp(control, b, t), segment.age);
  return { node, first, second };
}
