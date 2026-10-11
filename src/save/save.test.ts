import { describe, expect, it } from 'vitest';
import { TIME } from '../config/settings';
import type { ZoneId } from '../config/zones';
import { buildService } from '../sim/actions';
import { setTaxRate, takeLoan } from '../sim/economy/budget';
import { commitRoad, planRoad } from '../sim/roads/builder';
import { planService } from '../sim/services/services';
import { createWorld, stepWorld, type World } from '../sim/world';
import { paintZone, roadsChanged } from '../sim/zoning/growth';
import { fromSave, SAVE_VERSION, toSave } from './save';

const TICKS_PER_MONTH = TIME.ticksPerDay * TIME.daysPerMonth;

function road(world: World, x1: number, z1: number, x2: number, z2: number, control?: { x: number; z: number }): void {
  const plan = planRoad(world.roads, { start: { x: x1, z: z1 }, end: { x: x2, z: z2 }, control, type: 'small' });
  expect(plan.problem).toBeNull();
  commitRoad(world.roads, plan);
  roadsChanged(world);
}

function settle(world: World, zone: ZoneId, x1: number, x2: number, z: number): void {
  for (let x = x1; x <= x2; x += 8) paintZone(world, x, z, 26, zone);
}

function simulate(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) stepWorld(world);
}

/** Eine Stadt mit allem, was ein Spielstand enthalten kann. */
function city(): World {
  const world = createWorld();
  road(world, -240, -120, 240, -120);
  road(world, -240, 120, 240, 120);
  for (const x of [-160, 0, 160]) road(world, x, -120, x, 120);
  road(world, 240, -120, 320, -40, { x: 320, z: -120 });
  settle(world, 'residentialLow', -236, 236, -148);
  settle(world, 'commercial', -236, -4, 148);
  settle(world, 'industrial', 4, 236, 148);
  simulate(world, TICKS_PER_MONTH * 3);
  world.milestone = 3;
  world.economy.money = 50000;
  for (const [type, x] of [['windTurbine', -100], ['waterTower', -60], ['park', 60]] as const) {
    expect(buildService(world, planService(world, type, { x, z: -100 })!)).toBeNull();
  }
  takeLoan(world, 10000);
  setTaxRate(world, 'commercial', 12);
  world.sandbox.unlockAll = true;
  // Mitten im Monat und mitten am Tag speichern, nicht an einer runden Stelle.
  simulate(world, TICKS_PER_MONTH + 137);
  return world;
}

/** Speichern, als Text ablegen und wieder laden: wie in der Datei oder im Browser-Speicher. */
function reload(world: World): World {
  return fromSave(JSON.parse(JSON.stringify(toSave(world, '2026-01-01T12:00:00.000Z'))));
}

describe('Spielstand', () => {
  it('stellt Straßen, Zonen, Gebäude, Dienste und Kasse genau wieder her', () => {
    const world = city();
    const loaded = reload(world);

    expect(loaded.tick).toBe(world.tick);
    expect([...loaded.roads.nodes.values()]).toEqual([...world.roads.nodes.values()]);
    expect([...loaded.roads.segments.values()]).toEqual([...world.roads.segments.values()]);
    expect(loaded.roads.nextId).toBe(world.roads.nextId);
    expect([...loaded.buildings.values()]).toEqual([...world.buildings.values()]);
    expect([...loaded.services.values()]).toEqual([...world.services.values()]);
    expect(loaded.economy).toEqual(world.economy);
    expect(loaded.milestone).toBe(3);
    expect(loaded.sandbox).toEqual({ infiniteMoney: false, unlockAll: true });
    expect(loaded.stats).toEqual(world.stats);
    expect(loaded.city).toEqual(world.city);
    expect([...loaded.traffic.flows]).toEqual([...world.traffic.flows]);

    // Das Zellraster entsteht neu, muss aber Zelle für Zelle dasselbe sein.
    const summary = (w: World) => w.zoning.cells.map((cell) => [cell.x, cell.z, cell.zone, cell.building]);
    expect(summary(loaded)).toEqual(summary(world));
    expect(world.zoning.cells.some((cell) => cell.zone !== null)).toBe(true);
    expect(world.zoning.cells.some((cell) => cell.building !== null)).toBe(true);
  });

  it('läuft nach dem Laden genau so weiter wie ohne Speichern', () => {
    const world = city();
    const loaded = reload(world);
    simulate(world, TICKS_PER_MONTH * 2 + 55);
    simulate(loaded, TICKS_PER_MONTH * 2 + 55);
    expect(loaded.stats).toEqual(world.stats);
    expect(loaded.economy).toEqual(world.economy);
    expect(loaded.buildings.size).toBe(world.buildings.size);
    expect([...loaded.buildings.values()]).toEqual([...world.buildings.values()]);
    expect([...loaded.traffic.flows]).toEqual([...world.traffic.flows]);
  });

  it('teilt keine Objekte mit dem Spielstand', () => {
    const world = city();
    const save = toSave(world, 'x');
    const loaded = fromSave(save);
    loaded.economy.money = -1;
    [...loaded.buildings.values()][0].capacity = 9999;
    expect(world.economy.money).not.toBe(-1);
    expect([...world.buildings.values()][0].capacity).not.toBe(9999);
  });

  it('lässt sich vollständig als Text ablegen', () => {
    const save = toSave(city(), 'x', { x: 1, z: 2, distance: 300, yaw: 0.5, pitch: 0.9 });
    const copy = JSON.parse(JSON.stringify(save));
    expect(copy).toEqual(save);
    expect(copy.camera).toEqual({ x: 1, z: 2, distance: 300, yaw: 0.5, pitch: 0.9 });
    expect(copy.version).toBe(SAVE_VERSION);
  });

  it('lädt auch eine leere Stadt', () => {
    const loaded = reload(createWorld());
    expect(loaded.roads.segments.size).toBe(0);
    expect(loaded.zoning.cells).toHaveLength(0);
    simulate(loaded, 100);
    expect(loaded.tick).toBe(100);
  });

  it('weist kaputte oder fremde Dateien mit einer klaren Meldung ab', () => {
    const good = toSave(city(), 'x');
    expect(() => fromSave(null)).toThrow('Kein gültiger Spielstand');
    expect(() => fromSave({ hallo: 'welt' })).toThrow('Kein gültiger Spielstand');
    expect(() => fromSave({ ...good, version: 99 })).toThrow('Version 99');
    const dangling = JSON.parse(JSON.stringify(good));
    dangling.roads.segments[0].from = 123456;
    expect(() => fromSave(dangling)).toThrow('fehlende Knoten');
    const strange = JSON.parse(JSON.stringify(good));
    strange.buildings[0].zone = 'schloss';
    expect(() => fromSave(strange)).toThrow('unbekannte Zone');
  });
});
