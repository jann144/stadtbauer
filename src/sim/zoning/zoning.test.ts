import { describe, expect, it } from 'vitest';
import { GROWTH } from '../../config/balance';
import { ZONE_DEPTH, ZONE_TYPES } from '../../config/zones';
import { onLot } from '../buildings';
import { demandFor } from '../economy/demand';
import { commitRoad, planRoad } from '../roads/builder';
import { removeSegment } from '../roads/graph';
import { createWorld, stepWorld, type World } from '../world';
import { layoutCells } from './cells';
import { paintZone, roadsChanged } from './growth';

function road(world: World, x1: number, z1: number, x2: number, z2: number) {
  const plan = planRoad(world.roads, { start: { x: x1, z: z1 }, end: { x: x2, z: z2 }, type: 'small' });
  expect(plan.problem).toBeNull();
  const created = commitRoad(world.roads, plan);
  roadsChanged(world);
  return created;
}

function simulate(world: World, steps: number): void {
  for (let i = 0; i < steps; i++) stepWorld(world);
}

describe('Zonenzellen', () => {
  it('legt beidseitig einer geraden Straße sechs Reihen an', () => {
    const world = createWorld();
    road(world, 0, 0, 80, 0);
    const cells = world.zoning.cells;
    // 80 m Straße = 10 Spalten, zwei Seiten, sechs Reihen.
    expect(cells).toHaveLength(10 * 2 * ZONE_DEPTH);
    // Die erste Reihe liegt eine halbe Zelle hinter dem Straßenrand (8 m + 4 m).
    const firstRow = cells.filter((cell) => cell.row === 0);
    for (const cell of firstRow) expect(Math.abs(cell.z)).toBeCloseTo(12, 6);
    expect(new Set(cells.map((cell) => `${Math.round(cell.x)}/${Math.round(cell.z)}`)).size).toBe(cells.length);
  });

  it('hält Zellen von Querstraßen und anderen Zellen fern', () => {
    const world = createWorld();
    road(world, -100, 0, 100, 0);
    road(world, 0, -100, 0, 100);
    for (const cell of world.zoning.cells) {
      // Keine Zellmitte näher als Straßenrand plus halbe Zelle (minus Toleranz) an einer Achse.
      expect(Math.min(Math.abs(cell.x), Math.abs(cell.z))).toBeGreaterThan(11);
    }
    const cells = world.zoning.cells;
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const gap = Math.hypot(cells[i].x - cells[j].x, cells[i].z - cells[j].z);
        expect(gap).toBeGreaterThan(7);
      }
    }
  });

  it('lässt an der Innenseite einer Kurve keine Zellen überlappen', () => {
    const world = createWorld();
    const plan = planRoad(world.roads, {
      start: { x: -80, z: 0 },
      end: { x: 0, z: 80 },
      control: { x: 0, z: 0 },
      type: 'small',
    });
    expect(plan.problem).toBeNull();
    commitRoad(world.roads, plan);
    const cells = layoutCells(world.roads).cells;
    expect(cells.length).toBeGreaterThan(50);
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        expect(Math.hypot(cells[i].x - cells[j].x, cells[i].z - cells[j].z)).toBeGreaterThan(7);
      }
    }
  });

  it('behält Zonen, wenn eine Straße durch eine Kreuzung geteilt wird', () => {
    const world = createWorld();
    road(world, -100, 0, 100, 0);
    expect(paintZone(world, 60, 12, 5, 'commercial')).toBe(true);
    const zoned = () => world.zoning.cells.filter((cell) => cell.zone === 'commercial');
    const before = zoned().length;
    expect(before).toBeGreaterThan(0);

    // Die Kreuzung teilt die Straße; ihre Zellen werden neu angelegt und leicht verschoben.
    road(world, 0, 0, 0, -100);
    expect(zoned()).toHaveLength(before);
    for (const cell of zoned()) expect(Math.hypot(cell.x - 60, cell.z - 12)).toBeLessThan(8);
  });
});

describe('Zonenzellen nach Änderungen am Netz', () => {
  it('lässt gegenüber einer Einmündung das Bauland stehen', () => {
    const world = createWorld();
    road(world, -100, 0, 100, 0);
    const south = () => world.zoning.cells.filter((cell) => cell.z > 0);
    const before = south().length;
    road(world, 0, 0, 0, -80);
    // Die Hälften verlieren durch das Neuaufteilen höchstens eine Spalte, aber kein Loch von 20 m.
    expect(south().length).toBeGreaterThanOrEqual(before - ZONE_DEPTH);
    expect(south().some((cell) => Math.abs(cell.x) <= 8)).toBe(true);
    // Auf der Seite der Einmündung bleiben die Zellen von der neuen Straße fern.
    for (const cell of world.zoning.cells) {
      if (cell.z < 0) expect(Math.abs(cell.x)).toBeGreaterThan(11);
    }
  });

  it('nutzt die volle Länge, auch wenn sie rechnerisch knapp unter einem Vielfachen von 8 m liegt', () => {
    const world = createWorld();
    road(world, 13.37, -42.5, 29.37, -42.5);
    expect(world.zoning.cells).toHaveLength(2 * 2 * ZONE_DEPTH);
  });

  it('lässt der älteren Straße ihr Bauland, wenn sie geteilt wird', () => {
    const world = createWorld();
    road(world, -100, 0, 100, 0);
    road(world, -96, 76, 104, 76);
    // Alles zwischen den beiden Straßen als Gewerbe ausweisen.
    for (let x = -100; x <= 104; x += 8) {
      for (let z = 12; z <= 64; z += 8) paintZone(world, x, z, 6, 'commercial');
    }
    const zoned = () => world.zoning.cells.filter((cell) => cell.zone === 'commercial').length;
    const before = zoned();
    expect(before).toBeGreaterThan(100);

    // Eine Einmündung auf der abgewandten Seite teilt die ältere Straße.
    road(world, 0, -80, 0, 0);
    expect(zoned()).toBeGreaterThan(before * 0.9);
  });
});

describe('Nachfrage', () => {
  it('startet in einer leeren Stadt nur mit Wohnraum', () => {
    const demand = demandFor({ residents: 0, commercialJobs: 0, industrialJobs: 0 });
    expect(demand.residential).toBe(GROWTH.baseResidentialDemand);
    expect(demand.commercial).toBe(0);
    expect(demand.industrial).toBe(0);
  });

  it('verlangt Arbeitsplätze, wenn Einwohner ohne Arbeit sind', () => {
    const demand = demandFor({ residents: 200, commercialJobs: 0, industrialJobs: 0 });
    expect(demand.residential).toBe(0);
    expect(demand.commercial).toBeGreaterThan(0.5);
    expect(demand.industrial).toBeGreaterThan(0.5);
  });

  it('verlangt Wohnraum, wenn Arbeitsplätze unbesetzt sind', () => {
    const demand = demandFor({ residents: 100, commercialJobs: 100, industrialJobs: 100 });
    expect(demand.residential).toBe(1);
    expect(demand.commercial).toBe(0);
  });
});

describe('Wachstum', () => {
  it('baut nur dort, wo eine Zone ausgewiesen ist', () => {
    const world = createWorld();
    road(world, -100, 0, 100, 0);
    simulate(world, 400);
    expect(world.buildings.size).toBe(0);

    // Nur die Nordseite (z < 0) als Wohngebiet ausweisen.
    for (let x = -96; x <= 96; x += 8) paintZone(world, x, -20, 14, 'residentialLow');
    simulate(world, 600);
    expect(world.buildings.size).toBeGreaterThan(2);
    for (const building of world.buildings.values()) {
      expect(building.zone).toBe('residentialLow');
      expect(building.z).toBeLessThan(0);
      const [minWidth, maxWidth] = ZONE_TYPES.residentialLow.lotWidth;
      expect(building.width).toBeGreaterThanOrEqual(minWidth);
      expect(building.width).toBeLessThanOrEqual(maxWidth);
    }
    expect(world.stats.residents).toBeGreaterThan(0);
  });

  it('baut auch, wenn die erste Spalte einer Reihe zu flach ausgewiesen ist', () => {
    const world = createWorld();
    road(world, -100, 0, 100, 0);
    // Ein einzelner runder Pinseltupfer: außen nur eine Reihe tief, in der Mitte zwei.
    paintZone(world, 4, 12, 14, 'residentialLow');
    simulate(world, 800);
    expect(world.buildings.size).toBeGreaterThan(0);
  });

  it('bebaut auch die Innenseite einer Kurve', () => {
    const world = createWorld();
    const plan = planRoad(world.roads, {
      start: { x: -80, z: 0 },
      end: { x: 0, z: 80 },
      control: { x: 0, z: 0 },
      type: 'small',
    });
    commitRoad(world.roads, plan);
    roadsChanged(world);
    // Die Kurve biegt nach rechts, also ist Seite 1 innen. Dort müssen zwei Reihen nebeneinander Platz haben.
    const inner = world.zoning.cells.filter((cell) => cell.side === 1);
    expect(inner.filter((cell) => cell.row === 1).length).toBeGreaterThan(4);
    for (const cell of inner) cell.zone = 'residentialLow';
    simulate(world, 2000);
    expect(world.buildings.size).toBeGreaterThan(1);
  });

  it('stellt keine zwei Gebäude auf dieselbe Zelle', () => {
    const world = createWorld();
    road(world, -100, 0, 100, 0);
    for (let x = -96; x <= 96; x += 8) {
      paintZone(world, x, -28, 26, 'residentialLow');
      paintZone(world, x, 28, 26, 'commercial');
    }
    simulate(world, 3000);
    const buildings = [...world.buildings.values()];
    expect(buildings.length).toBeGreaterThan(4);
    for (const cell of world.zoning.cells) {
      const owners = buildings.filter((building) => onLot(building, cell, -0.5));
      expect(owners.length).toBeLessThanOrEqual(1);
      if (owners.length === 1) expect(cell.building).toBe(owners[0].id);
    }
  });

  it('hört auf zu wachsen, wenn Arbeitsplätze fehlen', () => {
    const world = createWorld();
    road(world, -400, 0, 400, 0);
    for (let x = -396; x <= 396; x += 8) paintZone(world, x, -28, 26, 'residentialLow');
    simulate(world, 6000);
    const residents = world.stats.residents;
    expect(residents).toBeGreaterThan(0);
    expect(world.demand.residential).toBe(0);
    simulate(world, 2000);
    expect(world.stats.residents).toBe(residents);
  });

  it('reißt Gebäude ab, wenn ihre Straße verschwindet oder eine neue hindurchführt', () => {
    const world = createWorld();
    const [main] = road(world, -100, 0, 100, 0);
    for (let x = -96; x <= 96; x += 8) paintZone(world, x, -28, 26, 'residentialLow');
    simulate(world, 600);
    const before = world.buildings.size;
    expect(before).toBeGreaterThan(2);

    // Neue Straße quer durch die Häuserreihe.
    road(world, -90, -22, 90, -22);
    expect(world.buildings.size).toBeLessThan(before);
    for (const cell of world.zoning.cells) {
      if (cell.building !== null) expect(world.buildings.has(cell.building)).toBe(true);
    }

    for (const id of [...world.roads.segments.keys()]) removeSegment(world.roads, id);
    roadsChanged(world);
    expect(main.id).toBeGreaterThan(0);
    expect(world.buildings.size).toBe(0);
    expect(world.zoning.cells).toHaveLength(0);
    // Die Anzeige zählt sofort neu, nicht erst beim nächsten Wachstumsschritt.
    expect(world.stats.residents).toBe(0);
  });
});
