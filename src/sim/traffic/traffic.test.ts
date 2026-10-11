import { describe, expect, it } from 'vitest';
import { TIME } from '../../config/settings';
import { CONGESTION, TRAFFIC } from '../../config/traffic';
import type { ZoneId } from '../../config/zones';
import { commitRoad, planRoad } from '../roads/builder';
import { removeSegment, shapeOf } from '../roads/graph';
import { accessOf } from '../services/network';
import { updateServices } from '../services/services';
import { createWorld, stepWorld, type World } from '../world';
import { paintZone, roadsChanged } from '../zoning/growth';
import { findRoute } from './routes';
import { congestion, speedShare, type Car } from './traffic';

const TICKS_PER_MONTH = TIME.ticksPerDay * TIME.daysPerMonth;

function road(world: World, x1: number, z1: number, x2: number, z2: number): void {
  const plan = planRoad(world.roads, { start: { x: x1, z: z1 }, end: { x: x2, z: z2 }, type: 'small' });
  expect(plan.problem).toBeNull();
  commitRoad(world.roads, plan);
  roadsChanged(world);
}

function settle(world: World, zone: ZoneId, x1: number, x2: number, z: number): void {
  for (let x = x1; x <= x2; x += 8) paintZone(world, x, z, 26, zone);
}

function simulate(world: World, ticks: number, eachTick?: () => void): void {
  for (let i = 0; i < ticks; i++) {
    stepWorld(world);
    eachTick?.();
  }
}

/**
 * Zwei lange Straßen, durch drei Querstraßen verbunden: Wohnhäuser an der nördlichen,
 * Gewerbe und Industrie an der südlichen. Jede Fahrt führt über Kreuzungen.
 */
function town(): World {
  const world = createWorld();
  road(world, -240, -120, 240, -120);
  road(world, -240, 120, 240, 120);
  for (const x of [-160, 0, 160]) road(world, x, -120, x, 120);
  settle(world, 'residentialLow', -236, 236, -148);
  settle(world, 'commercial', -236, -4, 148);
  settle(world, 'industrial', 4, 236, 148);
  simulate(world, TICKS_PER_MONTH * 3);
  return world;
}

/** Lässt für einen Test viel mehr Autos fahren, als die Stadt eigentlich hergibt. */
function withManyCars<T>(run: () => T): T {
  const normal = TRAFFIC.carsPerResident;
  TRAFFIC.carsPerResident = 5;
  try {
    return run();
  } finally {
    TRAFFIC.carsPerResident = normal;
  }
}

const flatSpeed = (world: World) => (segment: Parameters<typeof shapeOf>[1]) => shapeOf(world.roads, segment).length / 10;

describe('Wegsuche', () => {
  it('fährt auf derselben Straße direkt in beide Richtungen', () => {
    const world = createWorld();
    road(world, 0, 0, 200, 0);
    const [segment] = world.roads.segments.values();
    const a = { segment: segment.id, distance: 40 };
    const b = { segment: segment.id, distance: 150 };
    expect(findRoute(world.roads, a, b, flatSpeed(world))).toEqual([{ segment: segment.id, forward: true, start: 40, end: 150 }]);
    expect(findRoute(world.roads, b, a, flatSpeed(world))).toEqual([{ segment: segment.id, forward: false, start: 50, end: 160 }]);
  });

  it('findet den kürzesten Weg über Kreuzungen', () => {
    const world = createWorld();
    road(world, 0, 0, 300, 0);
    road(world, 300, 0, 300, 100);
    road(world, 300, 100, 0, 100);
    road(world, 0, 0, 0, 100);
    // Von unten links nach oben links: über die kurze linke Seite, nicht außen herum.
    const from = accessOf(world.roads, { x: 40, z: 8 })!;
    const to = accessOf(world.roads, { x: 40, z: 92 })!;
    const legs = findRoute(world.roads, from, to, flatSpeed(world))!;
    const driven = legs.reduce((sum, leg) => sum + (leg.end - leg.start), 0);
    expect(driven).toBeCloseTo(40 + 100 + 40, 3);
    expect(legs).toHaveLength(3);
  });

  it('weicht aus, wenn der kurze Weg langsam ist', () => {
    const world = createWorld();
    road(world, 0, 0, 300, 0);
    road(world, 300, 0, 300, 100);
    road(world, 300, 100, 0, 100);
    road(world, 0, 0, 0, 100);
    const from = accessOf(world.roads, { x: 40, z: 8 })!;
    const to = accessOf(world.roads, { x: 40, z: 92 })!;
    const shortcut = accessOf(world.roads, { x: 8, z: 50 })!.segment;
    const jammed = (segment: Parameters<typeof shapeOf>[1]) =>
      (shapeOf(world.roads, segment).length / 10) * (segment.id === shortcut ? 50 : 1);
    const legs = findRoute(world.roads, from, to, jammed)!;
    expect(legs.some((leg) => leg.segment === shortcut)).toBe(false);
    const driven = legs.reduce((sum, leg) => sum + (leg.end - leg.start), 0);
    expect(driven).toBeCloseTo(260 + 100 + 260, 3);
  });

  it('meldet, wenn es keine Verbindung gibt', () => {
    const world = createWorld();
    road(world, 0, 0, 100, 0);
    road(world, 0, 200, 100, 200);
    const from = accessOf(world.roads, { x: 40, z: 8 })!;
    const to = accessOf(world.roads, { x: 40, z: 208 })!;
    expect(findRoute(world.roads, from, to, flatSpeed(world))).toBeNull();
  });
});

describe('Verkehr', () => {
  it('bleibt ohne Einwohner oder ohne Arbeitsplätze leer', () => {
    const world = createWorld();
    road(world, -100, 0, 100, 0);
    settle(world, 'residentialLow', -96, 96, -28);
    simulate(world, 1200);
    expect(world.stats.residents).toBeGreaterThan(0);
    expect(world.traffic.cars).toHaveLength(0);
  });

  it('lässt so viele Autos fahren, wie zur Einwohnerzahl passen, und nie mehr als die Höchstzahl', () => {
    const world = town();
    const wanted = Math.floor(world.stats.residents * TRAFFIC.carsPerResident);
    expect(wanted).toBeGreaterThan(2);
    simulate(world, 300, () => {
      expect(world.traffic.cars.length).toBeLessThanOrEqual(Math.floor(world.stats.residents * TRAFFIC.carsPerResident));
    });
    expect(world.traffic.cars.length).toBeGreaterThan(0);

    withManyCars(() => {
      simulate(world, 600, () => expect(world.traffic.cars.length).toBeLessThanOrEqual(TRAFFIC.maxCars));
      expect(world.traffic.cars.length).toBeGreaterThan(wanted);
    });
  });

  it('bringt Autos ans Ziel und startet neue', () => {
    const world = town();
    simulate(world, 2400);
    const driving = world.traffic.cars.length;
    // Es wurden deutlich mehr Fahrten begonnen, als gerade Autos unterwegs sind: die übrigen sind angekommen.
    expect(world.traffic.nextCarId - 1).toBeGreaterThan(driving * 2);
    for (const car of world.traffic.cars) {
      expect(Number.isFinite(car.x) && Number.isFinite(car.z) && Number.isFinite(car.angle)).toBe(true);
    }
  });

  it('hält auch im dichten Verkehr Abstand und lässt je Kreuzung nur ein Auto fahren', () => {
    const world = town();
    withManyCars(() => {
      const before = world.traffic.cars.length;
      const firstNewId = world.traffic.nextCarId;
      simulate(world, 3000, () => {
        const cars = world.traffic.cars;
        // Abstand je Fahrspur.
        const lanes = new Map<string, Car[]>();
        const turning = new Map<number, number>();
        for (const car of cars) {
          if (car.turn) {
            if (car.turn.node !== null) turning.set(car.turn.node, (turning.get(car.turn.node) ?? 0) + 1);
            continue;
          }
          // Kleine Straßen haben je Richtung eine Spur.
          const leg = car.legs[car.leg];
          const key = `${leg.segment}|${leg.forward}`;
          lanes.set(key, [...(lanes.get(key) ?? []), car]);
        }
        for (const lane of lanes.values()) {
          lane.sort((a, b) => a.s - b.s);
          for (let i = 1; i < lane.length; i++) expect(lane[i].s - lane[i - 1].s).toBeGreaterThan(TRAFFIC.carLength);
        }
        for (const count of turning.values()) expect(count).toBe(1);
        expect(world.traffic.busyNodes.size).toBe(turning.size);
      });
      // Der Verkehr fließt: in fünf Minuten kommen viele Autos an, nichts hat sich festgefahren.
      const arrivals = before + (world.traffic.nextCarId - firstNewId) - world.traffic.cars.length;
      expect(arrivals).toBeGreaterThan(100);
    });
  });

  it('zählt die Belastung der befahrenen Straßen und lässt sie wieder verblassen', () => {
    const world = town();
    simulate(world, 1200);
    const used = [...world.traffic.flows.keys()];
    expect(used.length).toBeGreaterThan(3);
    const busiest = used.reduce((a, b) => (congestion(world, a) >= congestion(world, b) ? a : b));
    const before = congestion(world, busiest);
    expect(before).toBeGreaterThan(0);

    // Ohne Arbeitsstätten (und ohne Zonen, in denen neue entstehen) fährt niemand mehr; die Messwerte klingen ab.
    for (const cell of world.zoning.cells) {
      if (cell.zone !== 'residentialLow') cell.zone = null;
    }
    for (const building of [...world.buildings.values()]) {
      if (building.zone !== 'residentialLow') world.buildings.delete(building.id);
    }
    world.buildingsVersion++;
    simulate(world, TICKS_PER_MONTH * 2);
    expect(world.traffic.cars).toHaveLength(0);
    expect(congestion(world, busiest)).toBeLessThan(before * 0.05);
  });

  it('misst die Belastung unabhängig von den sichtbaren Autos', () => {
    const busiest = (world: World): number => Math.max(...[...world.traffic.flows.keys()].map((id) => congestion(world, id)));
    const withCars = town();
    simulate(withCars, TICKS_PER_MONTH * 2);

    const normal = TRAFFIC.maxCars;
    TRAFFIC.maxCars = 0;
    try {
      const without = town();
      simulate(without, TICKS_PER_MONTH * 2);
      expect(without.traffic.cars).toHaveLength(0);
      // Dieselbe Stadt, dieselben gewürfelten Fahrten: dieselbe Belastung, ob Autos zu sehen sind oder nicht.
      expect(busiest(without)).toBeCloseTo(busiest(withCars), 9);
      expect(busiest(without)).toBeGreaterThan(0);
    } finally {
      TRAFFIC.maxCars = normal;
    }
  });

  it('zählt auf der einzigen Straße einer Stadt alle Fahrten des Tages', () => {
    const world = createWorld();
    road(world, -200, 0, 200, 0);
    settle(world, 'residentialLow', -196, 196, -28);
    settle(world, 'commercial', -196, -4, 28);
    settle(world, 'industrial', 4, 196, 28);
    simulate(world, TICKS_PER_MONTH * 6);
    const [segment] = world.roads.segments.values();
    const trips = world.stats.residents * TRAFFIC.tripsPerResident;
    const capacity = 2 * TRAFFIC.capacityPerLane;
    // Die Stadt wächst noch etwas; die geglättete Messung liegt deshalb knapp unter dem jetzigen Wert.
    expect(congestion(world, segment.id)).toBeGreaterThan((trips / capacity) * 0.8);
    expect(congestion(world, segment.id)).toBeLessThanOrEqual((trips / capacity) * 1.01);
  });

  it('behält die gemessene Belastung, wenn eine Straße geteilt oder wieder zusammengelegt wird', () => {
    const world = createWorld();
    road(world, -200, 0, 200, 0);
    const [whole] = world.roads.segments.values();
    world.traffic.flows.set(whole.id, 5000);
    world.traffic.lineage.set(whole.id, whole.age);
    const before = congestion(world, whole.id);

    // Eine Einmündung teilt die Straße in zwei neue Stücke.
    road(world, 0, 0, 0, 60);
    const halves = [...world.roads.segments.values()].filter((segment) => segment.age === whole.age);
    expect(halves).toHaveLength(2);
    for (const half of halves) expect(congestion(world, half.id)).toBeCloseTo(before, 9);

    // Der Abriss der Einmündung legt sie wieder zusammen.
    const stub = [...world.roads.segments.values()].find((segment) => segment.age !== whole.age)!;
    removeSegment(world.roads, stub.id);
    roadsChanged(world);
    const [merged] = world.roads.segments.values();
    expect(world.roads.segments.size).toBe(1);
    expect(congestion(world, merged.id)).toBeCloseTo(before, 9);
  });

  it('bremst den Verkehr auf vollen Straßen, aber nie bis zum Stillstand', () => {
    expect(speedShare(0)).toBe(1);
    expect(speedShare(1)).toBeCloseTo(0.5, 9);
    expect(speedShare(100)).toBe(TRAFFIC.slowestShare);
    for (let ratio = 0; ratio < 3; ratio += 0.1) expect(speedShare(ratio + 0.1)).toBeLessThanOrEqual(speedShare(ratio));
  });

  it('senkt die Zufriedenheit der Anlieger einer überlasteten Straße', () => {
    const world = town();
    const [home] = world.buildings.values();
    const segment = accessOf(world.roads, { x: home.frontX, z: home.frontZ })!.segment;
    updateServices(world);
    const calm = home.happiness;
    expect(world.city.congested).toBe(0);

    // Doppelt so viele Fahrten, wie die Straße verträgt.
    const lanes = 2;
    world.traffic.flows.set(segment, (2 * lanes * TRAFFIC.capacityPerLane) / (1 - TRAFFIC.memory));
    expect(congestion(world, segment)).toBeCloseTo(2, 6);
    updateServices(world);
    expect(home.happiness).toBeCloseTo(calm - CONGESTION.penalty, 9);
    expect(world.city.congested).toBeGreaterThan(0);
  });

  it('beendet alle Fahrten, wenn sich das Straßennetz ändert', () => {
    const world = town();
    simulate(world, 600);
    expect(world.traffic.cars.length).toBeGreaterThan(0);
    road(world, -240, -120, -240, 120);
    expect(world.traffic.cars).toHaveLength(0);
    expect(world.traffic.busyNodes.size).toBe(0);
    for (const segment of world.traffic.flows.keys()) expect(world.roads.segments.has(segment)).toBe(true);
    // Danach läuft der Verkehr auf dem neuen Netz wieder an.
    simulate(world, 600);
    expect(world.traffic.cars.length).toBeGreaterThan(0);
  });

  it('läuft bei gleichem Ausgangszustand genau gleich ab', () => {
    const first = town();
    const second = town();
    simulate(first, 900);
    simulate(second, 900);
    expect(second.traffic.cars.map((car) => [car.id, car.x, car.z])).toEqual(first.traffic.cars.map((car) => [car.id, car.x, car.z]));
    expect([...second.traffic.flows]).toEqual([...first.traffic.flows]);
  });
});
