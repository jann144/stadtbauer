import { shapeOf, type RoadNetwork, type RoadSegment, nodeOf, segmentOf } from '../roads/graph';
import type { Access } from '../services/network';

/** Ein Abschnitt einer Fahrt: ein Stück eines Segments in einer Fahrtrichtung. */
export interface Leg {
  segment: number;
  /** Fahrt vom Anfangs- zum Endknoten des Segments, sonst umgekehrt. */
  forward: boolean;
  /** Fahrstrecke auf dem Segment von `start` bis `end`, gemessen in Fahrtrichtung ab dem Einfahrtsende. */
  start: number;
  end: number;
}

interface Step {
  time: number;
  node: number;
  /** Segment, über das der Knoten erreicht wurde, und der Knoten davor; beim Start gibt es beide nicht. */
  via: RoadSegment | null;
  before: number;
}

/** Kleinster Eintrag zuerst; hält die offenen Knoten der Wegsuche geordnet. */
class Queue {
  private readonly items: Step[] = [];

  get size(): number {
    return this.items.length;
  }

  push(step: Step): void {
    const items = this.items;
    let i = items.push(step) - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].time <= items[i].time) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop(): Step {
    const items = this.items;
    const top = items[0];
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < items.length && items[left].time < items[smallest].time) smallest = left;
        if (right < items.length && items[right].time < items[smallest].time) smallest = right;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i], items[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

/**
 * Sucht die schnellste Fahrt zwischen zwei Stellen des Straßennetzes. `timeOf` liefert die Fahrzeit
 * über ein ganzes Segment; so meidet die Suche volle Straßen. Null, wenn es keine Verbindung gibt.
 */
export function findRoute(
  net: RoadNetwork,
  from: Access,
  to: Access,
  timeOf: (segment: RoadSegment) => number,
): Leg[] | null {
  const origin = net.segments.get(from.segment);
  const target = net.segments.get(to.segment);
  if (!origin || !target) return null;
  const originLength = shapeOf(net, origin).length;
  const targetLength = shapeOf(net, target).length;

  // Start und Ziel an derselben Straße: einfach hinfahren.
  if (origin === target) {
    return to.distance >= from.distance
      ? [{ segment: origin.id, forward: true, start: from.distance, end: to.distance }]
      : [{ segment: origin.id, forward: false, start: originLength - from.distance, end: originLength - to.distance }];
  }

  const settled = new Map<number, Step>();
  const open = new Queue();
  const originTime = timeOf(origin);
  open.push({ time: (originTime * from.distance) / originLength, node: origin.from, via: null, before: -1 });
  open.push({ time: originTime * (1 - from.distance / originLength), node: origin.to, via: null, before: -1 });
  while (open.size > 0 && !(settled.has(target.from) && settled.has(target.to))) {
    const step = open.pop();
    if (settled.has(step.node)) continue;
    settled.set(step.node, step);
    for (const id of nodeOf(net, step.node).segments) {
      const segment = segmentOf(net, id);
      const next = segment.from === step.node ? segment.to : segment.from;
      if (!settled.has(next)) open.push({ time: step.time + timeOf(segment), node: next, via: segment, before: step.node });
    }
  }

  // Vom besseren der beiden Enden des Zielsegments aus das letzte Stück fahren.
  const targetTime = timeOf(target);
  const viaFrom = (settled.get(target.from)?.time ?? Infinity) + (targetTime * to.distance) / targetLength;
  const viaTo = (settled.get(target.to)?.time ?? Infinity) + targetTime * (1 - to.distance / targetLength);
  if (viaFrom === Infinity && viaTo === Infinity) return null;
  const entry = viaFrom <= viaTo ? target.from : target.to;

  const legs: Leg[] = [];
  legs.push(
    entry === target.from
      ? { segment: target.id, forward: true, start: 0, end: to.distance }
      : { segment: target.id, forward: false, start: 0, end: targetLength - to.distance },
  );
  let step = settled.get(entry)!;
  while (step.via) {
    const segment = step.via;
    legs.push({ segment: segment.id, forward: segment.to === step.node, start: 0, end: shapeOf(net, segment).length });
    step = settled.get(step.before)!;
  }
  legs.push(
    step.node === origin.to
      ? { segment: origin.id, forward: true, start: from.distance, end: originLength }
      : { segment: origin.id, forward: false, start: originLength - from.distance, end: originLength },
  );
  return legs.reverse();
}
