import { describe, expect, it } from 'vitest';
import { WORLD } from '../../config/settings';
import { distance, type Vec2 } from '../../util/vec2';
import { commitRoad, planRoad, type RoadProblem } from './builder';
import { bezierPoint, pointAt } from './geometry';
import { createNetwork, removeSegment, shapeOf, splitSegment, type RoadNetwork, type RoadNode } from './graph';

function at(x: number, z: number): Vec2 {
  return { x, z };
}

function build(net: RoadNetwork, start: Vec2, end: Vec2, control?: Vec2) {
  const plan = planRoad(net, { start, end, control, type: 'small' });
  expect(plan.problem).toBeNull();
  return commitRoad(net, plan);
}

function problem(net: RoadNetwork, start: Vec2, end: Vec2, control?: Vec2): RoadProblem | null {
  return planRoad(net, { start, end, control, type: 'small' }).problem;
}

function nodeAt(net: RoadNetwork, x: number, z: number): RoadNode {
  const node = [...net.nodes.values()].find((n) => distance(n, { x, z }) < 0.5);
  if (!node) throw new Error(`Kein Knoten bei ${x}/${z}`);
  return node;
}

/** Zwei Straßen, die sich im Ursprung kreuzen. */
function crossroads(): RoadNetwork {
  const net = createNetwork();
  build(net, at(-100, 0), at(100, 0));
  build(net, at(0, -100), at(0, 100));
  return net;
}

describe('Straßenbau', () => {
  it('baut eine einzelne Straße', () => {
    const net = createNetwork();
    const created = build(net, at(0, 0), at(80, 0));
    expect(created).toHaveLength(1);
    expect(net.nodes.size).toBe(2);
    expect(net.segments.size).toBe(1);
  });

  it('teilt beide Straßen an einer Kreuzung', () => {
    const net = crossroads();
    expect(net.nodes.size).toBe(5);
    expect(net.segments.size).toBe(4);
    expect(nodeAt(net, 0, 0).segments).toHaveLength(4);
  });

  it('schließt mitten an eine Straße an (Einmündung)', () => {
    const net = createNetwork();
    build(net, at(-100, 0), at(100, 0));
    build(net, at(0, 0), at(0, 100));
    expect(net.nodes.size).toBe(4);
    expect(net.segments.size).toBe(3);
    expect(nodeAt(net, 0, 0).segments).toHaveLength(3);
  });

  it('nutzt einen vorhandenen Endknoten weiter', () => {
    const net = createNetwork();
    build(net, at(-100, 0), at(100, 0));
    build(net, at(100, 0), at(100, 100));
    expect(net.nodes.size).toBe(3);
    expect(net.segments.size).toBe(2);
    expect(nodeAt(net, 100, 0).segments).toHaveLength(2);
  });

  it('führt eine neue Straße durch eine bestehende Kreuzung', () => {
    const net = crossroads();
    const created = build(net, at(-50, -50), at(50, 50));
    expect(created).toHaveLength(2);
    expect(net.nodes.size).toBe(7);
    expect(net.segments.size).toBe(6);
    expect(nodeAt(net, 0, 0).segments).toHaveLength(6);
  });

  it('kreuzt mit einem Bogen dieselbe Straße zweimal', () => {
    const net = createNetwork();
    build(net, at(-100, 0), at(100, 0));
    const created = build(net, at(-60, -30), at(60, -30), at(0, 60));
    expect(created).toHaveLength(3);
    expect(net.nodes.size).toBe(6);
    expect(net.segments.size).toBe(6);
    expect(nodeAt(net, -34.64, 0).segments).toHaveLength(4);
    expect(nodeAt(net, 34.64, 0).segments).toHaveLength(4);
  });

  it('behält beim Teilen die Form eines Bogens', () => {
    const net = createNetwork();
    const [curve] = build(net, at(-60, -30), at(60, -30), at(0, 60));
    const length = shapeOf(net, curve).length;
    const { first, second } = splitSegment(net, curve.id, length * 0.3);
    const original = (t: number) => bezierPoint(at(-60, -30), at(0, 60), at(60, -30), t);

    const firstMid = pointAt(shapeOf(net, first), shapeOf(net, first).length / 2);
    const secondMid = pointAt(shapeOf(net, second), shapeOf(net, second).length / 2);
    const nearestGap = (p: Vec2) =>
      Math.min(...Array.from({ length: 401 }, (_, i) => distance(p, original(i / 400))));
    expect(nearestGap(firstMid)).toBeLessThan(0.2);
    expect(nearestGap(secondMid)).toBeLessThan(0.2);
    expect(shapeOf(net, first).length + shapeOf(net, second).length).toBeCloseTo(length, 0);
  });

  it('lehnt zu kurze Straßen ab', () => {
    expect(problem(createNetwork(), at(0, 0), at(5, 0))).toBe('tooShort');
  });

  it('lehnt zu enge Kurven ab', () => {
    expect(problem(createNetwork(), at(0, 0), at(0, 6), at(30, 3))).toBe('tooSharp');
  });

  it('lehnt Straßen außerhalb der Karte ab', () => {
    const edge = WORLD.size / 2;
    expect(problem(createNetwork(), at(edge - 20, 0), at(edge + 20, 0))).toBe('outOfBounds');
  });

  it('lehnt spitze Winkel an einer Einmündung ab', () => {
    const net = createNetwork();
    build(net, at(-100, 0), at(100, 0));
    expect(problem(net, at(0, 0), at(100, 10))).toBe('angleTooSmall');
    expect(problem(net, at(0, 0), at(100, 60))).toBeNull();
  });

  it('lehnt Straßen ab, die auf oder dicht neben einer anderen liegen', () => {
    const net = createNetwork();
    build(net, at(-100, 0), at(100, 0));
    expect(problem(net, at(-50, 8), at(50, 8))).toBe('overlap');
    expect(problem(net, at(-50, 20), at(50, 20))).toBeNull();
    // Endet knapp vor der anderen Straße, ohne anzuschließen.
    expect(problem(net, at(0, 80), at(0, 3))).toBe('overlap');
  });

  it('lehnt Kreuzungen dicht neben einer bestehenden Kreuzung ab', () => {
    expect(problem(crossroads(), at(5, -50), at(5, 50))).toBe('tooCloseToJunction');
  });

  it('ändert das Netz beim Planen nicht', () => {
    const net = crossroads();
    planRoad(net, { start: at(-50, -50), end: at(50, 50), type: 'small' });
    expect(net.nodes.size).toBe(5);
    expect(net.segments.size).toBe(4);
  });

  it('räumt beim Abreißen verwaiste Knoten weg und fügt die Hauptstraße wieder zusammen', () => {
    const net = createNetwork();
    build(net, at(-100, 0), at(100, 0));
    const [stem] = build(net, at(0, 0), at(0, 100));
    expect(net.segments.size).toBe(3);
    removeSegment(net, stem.id);
    expect(net.segments.size).toBe(1);
    expect(net.nodes.size).toBe(2);
    for (const id of [...net.segments.keys()]) removeSegment(net, id);
    expect(net.nodes.size).toBe(0);
  });

  it('verschmilzt eine geradlinig weitergebaute Straße zu einem Stück', () => {
    const net = createNetwork();
    build(net, at(-100, 0), at(0, 0));
    const created = build(net, at(0, 0), at(100, 0));
    expect(net.segments.size).toBe(1);
    expect(net.nodes.size).toBe(2);
    expect(created).toHaveLength(1);
    expect(net.segments.has(created[0].id)).toBe(true);
    // An der früheren Nahtstelle gibt es keine unsichtbare Sperrzone für Kreuzungen mehr.
    expect(problem(net, at(5, -50), at(5, 50))).toBeNull();
  });

  it('lässt Knicke und Typwechsel als Knoten stehen', () => {
    const net = createNetwork();
    build(net, at(-100, 0), at(0, 0));
    build(net, at(0, 0), at(100, 30));
    expect(net.segments.size).toBe(2);
    const plan = planRoad(net, { start: at(-100, 0), end: at(-200, 0), type: 'medium' });
    expect(plan.problem).toBeNull();
    commitRoad(net, plan);
    expect(net.segments.size).toBe(3);
  });

  it('behält beim Teilen und Zusammenlegen das Alter einer Straße', () => {
    const net = createNetwork();
    const [main] = build(net, at(-100, 0), at(100, 0));
    const [stem] = build(net, at(0, 0), at(0, 100));
    for (const segment of net.segments.values()) {
      if (segment.id !== stem.id) expect(segment.age).toBe(main.age);
    }
    removeSegment(net, stem.id);
    expect([...net.segments.values()][0].age).toBe(main.age);
  });

  it('lehnt ein freies Ende ab, das in einer anderen Straße liegt', () => {
    const net = createNetwork();
    build(net, at(-100, 0), at(100, 0));
    expect(problem(net, at(0, 80), at(0, 12.1))).toBe('overlap');
    expect(problem(net, at(0, 80), at(0, 20))).toBeNull();
    // Ein unverbundener Anfang neben dem Querarm, obwohl gleich danach eine Kreuzung folgt.
    expect(problem(crossroads(), at(3, 16), at(26.5, -16))).toBe('overlap');
  });

  it('lehnt eine zweite Seitenstraße ab, die dicht neben der ersten verläuft', () => {
    const net = createNetwork();
    build(net, at(-100, 0), at(100, 0));
    build(net, at(-100, 70), at(100, 70));
    build(net, at(0, 0), at(0, 70));
    expect(problem(net, at(12, 0), at(12, 70))).toBe('overlap');
    expect(problem(net, at(40, 0), at(40, 70))).toBeNull();
  });

  it('lehnt eine Kurve ab, die auf sich selbst zurückläuft', () => {
    expect(problem(createNetwork(), at(0, 0), at(-50, 0.05), at(300, 0))).toBe('tooSharp');
  });
});
