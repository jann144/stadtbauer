import { describe, expect, it } from 'vitest';
import { MONEY } from '../../config/economy';
import { MILESTONES } from '../../config/milestones';
import { HAPPINESS, NEEDS, SERVICE_TYPES, type ServiceId } from '../../config/services';
import { TIME } from '../../config/settings';
import { ZONE_TYPES, type ZoneId, type ZoneKind } from '../../config/zones';
import { buildService, demolishBuilding, demolishRoad, demolishService } from '../actions';
import { demolitionValue, forecast, growthFactors, setTaxRate } from '../economy/budget';
import { commitRoad, planRoad } from '../roads/builder';
import { createWorld, stepWorld, type World } from '../world';
import { paintZone, roadsChanged } from '../zoning/growth';
import { accessOf, reachedStretches, reachFrom, roadComponents, roadDistance } from './network';
import { isNeedActive, levelCap, monthlyChanges, planService, updateServices } from './services';

const TICKS_PER_MONTH = TIME.ticksPerDay * TIME.daysPerMonth;
/** Stufe, ab der alle Dienste freigeschaltet sind. */
const ALL_UNLOCKED = MILESTONES.length - 1;

function road(world: World, x1: number, z1: number, x2: number, z2: number): void {
  const plan = planRoad(world.roads, { start: { x: x1, z: z1 }, end: { x: x2, z: z2 }, type: 'small' });
  expect(plan.problem).toBeNull();
  commitRoad(world.roads, plan);
  roadsChanged(world);
}

/** Baut ein Dienstgebäude am Straßenrand beim Punkt, ohne Geld zu prüfen. */
function service(world: World, type: ServiceId, x: number, z: number) {
  const plan = planService(world, type, { x, z });
  expect(plan?.valid).toBe(true);
  world.economy.money += SERVICE_TYPES[type].cost;
  expect(buildService(world, plan!)).toBeNull();
  return [...world.services.values()].at(-1)!;
}

/** Lässt auf einem Straßenabschnitt Gebäude einer Zone wachsen, indem sie direkt gesetzt werden. */
function settle(world: World, zone: ZoneId, x1: number, x2: number, z: number): void {
  for (let x = x1; x <= x2; x += 8) paintZone(world, x, z, 26, zone);
}

function simulate(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) stepWorld(world);
}

/** Eine Straße mit Wohnhäusern im Norden und Gewerbe sowie Industrie im Süden, alle Dienste freigeschaltet. */
function town(): World {
  const world = createWorld();
  road(world, -200, 0, 200, 0);
  settle(world, 'residentialLow', -196, 196, -28);
  settle(world, 'commercial', -196, -4, 28);
  settle(world, 'industrial', 4, 196, 28);
  simulate(world, TICKS_PER_MONTH * 2);
  world.milestone = ALL_UNLOCKED;
  updateServices(world);
  return world;
}

const kindOf = (world: World, id: number): ZoneKind => ZONE_TYPES[world.buildings.get(id)!.zone].kind;

describe('Wege im Straßennetz', () => {
  it('findet den Anschluss eines Punkts am Straßenrand', () => {
    const world = createWorld();
    road(world, 0, 0, 100, 0);
    const access = accessOf(world.roads, { x: 30, z: 8 })!;
    expect(access.distance).toBeCloseTo(30, 6);
    expect(accessOf(world.roads, { x: 30, z: 40 })).toBeNull();
  });

  it('unterscheidet getrennte Teilnetze', () => {
    const world = createWorld();
    road(world, 0, 0, 100, 0);
    road(world, 0, 0, 0, 100);
    road(world, 300, 0, 400, 0);
    const numbers = new Set(roadComponents(world.roads).values());
    expect(numbers.size).toBe(2);
  });

  it('misst die Strecke entlang der Straßen, nicht die Luftlinie', () => {
    const world = createWorld();
    // Zwei parallele Straßen, 60 m auseinander, nur am rechten Ende verbunden.
    road(world, 0, 0, 300, 0);
    road(world, 300, 0, 300, 60);
    road(world, 300, 60, 0, 60);
    const from = accessOf(world.roads, { x: 20, z: 8 })!;
    const to = accessOf(world.roads, { x: 20, z: 52 })!;
    const reach = reachFrom(world.roads, from, 1000);
    // 280 m bis zur Ecke, 60 m hinüber, 280 m zurück.
    expect(roadDistance(world.roads, from, reach, to)).toBeCloseTo(620, 3);
    // Mit kurzer Reichweite ist die andere Straße nicht erreichbar, obwohl sie nur 60 m entfernt liegt.
    expect(roadDistance(world.roads, from, reachFrom(world.roads, from, 200), to)).toBe(Infinity);
    const sameRoad = accessOf(world.roads, { x: 120, z: 8 })!;
    expect(roadDistance(world.roads, from, reach, sameRoad)).toBeCloseTo(100, 3);
  });

  it('liefert die erreichten Straßenabschnitte für die Anzeige', () => {
    const world = createWorld();
    road(world, 0, 0, 300, 0);
    const from = accessOf(world.roads, { x: 100, z: 8 })!;
    const stretches = reachedStretches(world.roads, from, 50);
    expect(stretches).toHaveLength(1);
    expect(stretches[0].from).toBeCloseTo(50, 6);
    expect(stretches[0].to).toBeCloseTo(150, 6);
    // Größer als die Straße: der ganze Abschnitt, aber nur einmal.
    expect(reachedStretches(world.roads, from, 1000)).toEqual([
      { segment: stretches[0].segment, from: 0, to: stretches[0].segment && 300 },
    ]);
  });
});

describe('Dienstgebäude bauen', () => {
  it('findet ein Grundstück am Straßenrand und belegt dessen Zellen', () => {
    const world = createWorld();
    world.milestone = ALL_UNLOCKED;
    road(world, -100, 0, 100, 0);
    const plan = planService(world, 'police', { x: 0, z: 14 })!;
    expect(plan.valid).toBe(true);
    expect(plan.lot.width).toBe(3);
    const before = world.economy.money;
    expect(buildService(world, plan)).toBeNull();
    expect(world.economy.money).toBe(before - SERVICE_TYPES.police.cost);
    const built = [...world.services.values()][0];
    const occupied = world.zoning.cells.filter((cell) => cell.building === built.id);
    expect(occupied).toHaveLength(9);
    // Auf belegtem Grund geht kein zweites Gebäude.
    expect(planService(world, 'park', { x: 0, z: 14 })!.valid).toBe(false);
    expect(planService(world, 'park', { x: 60, z: 14 })!.valid).toBe(true);
  });

  it('plant nichts, wo kein Bauland in der nötigen Größe liegt', () => {
    const world = createWorld();
    road(world, -100, 0, 100, 0);
    expect(planService(world, 'police', { x: 0, z: 300 })).toBeNull();
    // Am Straßenende fehlt die Breite für ein fünf Zellen breites Kraftwerk.
    expect(planService(world, 'powerPlant', { x: -96, z: 14 })).toBeNull();
  });

  it('verweigert gesperrte und zu teure Dienste', () => {
    const world = createWorld();
    road(world, -100, 0, 100, 0);
    const plan = planService(world, 'windTurbine', { x: 0, z: 14 })!;
    expect(buildService(world, plan)).toBe('locked');
    world.milestone = 2;
    world.economy.money = 100;
    expect(buildService(world, plan)).toBe('money');
    expect(world.services.size).toBe(0);
  });

  it('erstattet beim Abriss drei Viertel und gibt die Zellen frei', () => {
    const world = createWorld();
    world.milestone = ALL_UNLOCKED;
    road(world, -100, 0, 100, 0);
    const built = service(world, 'park', 0, 14);
    const before = world.economy.money;
    expect(demolishService(world, built.id)).toBe(1125);
    expect(world.economy.money).toBe(before + 1125);
    expect(world.zoning.cells.some((cell) => cell.building !== null)).toBe(false);
  });

  it('reißt Dienste mit ab, wenn ihre Straße verschwindet, und erstattet sie', () => {
    const world = createWorld();
    world.milestone = ALL_UNLOCKED;
    road(world, -100, 0, 100, 0);
    service(world, 'park', 0, 14);
    const before = world.economy.money;
    const [segment] = world.roads.segments.values();
    const roadRefund = demolishRoad(world, segment.id);
    expect(world.services.size).toBe(0);
    expect(world.economy.money).toBe(before + roadRefund + 1125);
  });

  it('baut nicht auf einen Platz, auf dem seit dem Planen ein Haus gewachsen ist', () => {
    const world = createWorld();
    world.milestone = ALL_UNLOCKED;
    road(world, -40, 0, 40, 0);
    settle(world, 'residentialLow', -36, 36, -28);
    // Auf dem Touchscreen liegt zwischen Antippen und „Bauen“ Spielzeit.
    const plan = planService(world, 'park', { x: 0, z: -14 })!;
    expect(plan.valid).toBe(true);
    simulate(world, 400);
    expect(world.buildings.size).toBeGreaterThan(0);
    const money = world.economy.money;
    expect(buildService(world, plan)).toBe('blocked');
    expect(world.services.size).toBe(0);
    expect(world.economy.money).toBe(money);
    for (const building of world.buildings.values()) {
      expect(world.zoning.cells.some((cell) => cell.building === building.id)).toBe(true);
    }
  });

  it('lässt auf einem Dienstgrundstück nichts wachsen', () => {
    const world = createWorld();
    world.milestone = ALL_UNLOCKED;
    road(world, -40, 0, 40, 0);
    settle(world, 'residentialLow', -36, 36, -28);
    const built = service(world, 'school', 0, -14);
    simulate(world, 600);
    for (const cell of world.zoning.cells) {
      if (cell.building === built.id) continue;
      if (cell.building !== null) expect(world.buildings.has(cell.building)).toBe(true);
    }
    expect(world.zoning.cells.filter((cell) => cell.building === built.id)).toHaveLength(16);
  });

  it('reißt ein gewachsenes Gebäude einzeln ab', () => {
    const world = town();
    const [building] = world.buildings.values();
    const money = world.economy.money;
    demolishBuilding(world, building.id);
    expect(world.buildings.has(building.id)).toBe(false);
    expect(world.zoning.cells.some((cell) => cell.building === building.id)).toBe(false);
    expect(world.economy.money).toBe(money);
  });
});

describe('Versorgung und Zufriedenheit', () => {
  it('verlangt nichts, solange kein Dienst freigeschaltet ist', () => {
    const world = town();
    world.milestone = 1;
    updateServices(world);
    expect(isNeedActive(world, 'power')).toBe(false);
    expect(world.city.happiness).toBe(1);
    for (const building of world.buildings.values()) expect(building.happiness).toBe(1);
  });

  it('senkt die Zufriedenheit um genau die ungedeckten Bedürfnisse', () => {
    const world = town();
    for (const building of world.buildings.values()) {
      const needs = NEEDS[kindOf(world, building.id)];
      const missing = Object.values(needs).reduce((sum, weight) => sum + weight, 0);
      expect(building.happiness).toBeCloseTo(1 - missing, 9);
    }
    expect(world.city.utilities.power.supply).toBe(0);
    expect(world.city.utilities.power.demand).toBeGreaterThan(0);
    expect(world.city.coverage.police).toBe(0);
  });

  it('zählt Versorger nach Leistung gegen Bedarf im selben Netz', () => {
    const world = town();
    const before = [...world.buildings.values()][0].happiness;
    // Das Windrad steht an einer eigenen, nicht verbundenen Straße: es hilft der Stadt nicht.
    road(world, -200, -150, 200, -150);
    service(world, 'windTurbine', -180, -138);
    expect(world.services.size).toBe(1);
    expect(world.city.utilities.power.supply).toBe(200);
    // Die Leistung ist da, erreicht aber niemanden: gedeckt ist nichts.
    expect(world.city.utilities.power.served).toBe(0);
    expect([...world.buildings.values()][0].happiness).toBeCloseTo(before, 9);
  });

  it('versorgt anteilig, wenn die Leistung nicht reicht', () => {
    const world = town();
    road(world, -200, 0, -200, 120);
    const [building] = world.buildings.values();
    const kind = kindOf(world, building.id);
    const before = building.happiness;
    service(world, 'windTurbine', -188, 100);
    const { supply, demand, served } = world.city.utilities.power;
    expect(supply).toBe(200);
    expect(served).toBe(Math.min(supply, demand));
    const share = Math.min(1, supply / demand);
    expect(world.buildings.get(building.id)!.happiness).toBeCloseTo(before + NEEDS[kind].power! * share, 9);
  });

  it('erreicht mit einem Dienst nur Gebäude innerhalb der Wegstrecke', () => {
    const world = createWorld();
    world.milestone = ALL_UNLOCKED;
    road(world, -500, 0, 500, 0);
    // Wohnhäuser an beiden Enden der Straße, Arbeitsplätze in der Mitte.
    settle(world, 'residentialLow', -496, -380, -28);
    settle(world, 'residentialLow', 380, 496, -28);
    settle(world, 'commercial', -100, -4, -28);
    settle(world, 'industrial', 4, 100, -28);
    simulate(world, TICKS_PER_MONTH * 2);
    const park = service(world, 'park', -480, 14);
    const range = SERVICE_TYPES.park.range!;
    const parkAccess = accessOf(world.roads, { x: park.frontX, z: park.frontZ })!;
    const homes = [...world.buildings.values()].filter((building) => building.zone === 'residentialLow');
    let reached = 0;
    for (const building of homes) {
      const access = accessOf(world.roads, { x: building.frontX, z: building.frontZ })!;
      const near = Math.abs(access.distance - parkAccess.distance) <= range;
      const missing = 1 - building.happiness;
      // Wer den Park erreicht, dem fehlt dessen Anteil nicht mehr.
      const others = Object.entries(NEEDS.residential).reduce((sum, [category, weight]) => sum + (category === 'park' ? 0 : weight), 0);
      expect(missing).toBeCloseTo(near ? others : others + NEEDS.residential.park!, 9);
      if (near) reached++;
    }
    expect(reached).toBeGreaterThan(0);
    expect(reached).toBeLessThan(homes.length);
    // Nur Wohnhäuser wünschen sich einen Park; der Anteil zählt also nur sie.
    expect(world.city.coverage.park).toBeCloseTo(reached / homes.length, 9);
  });

  it('zieht für Steuern über dem normalen Satz Zufriedenheit ab', () => {
    const world = town();
    const [home] = [...world.buildings.values()].filter((building) => building.zone === 'residentialLow');
    const before = home.happiness;
    setTaxRate(world, 'residential', 13);
    updateServices(world);
    expect(home.happiness).toBeCloseTo(before - 3 * HAPPINESS.taxPenaltyPerPoint, 9);
  });

  it('bremst das Wachstum bei Unzufriedenheit', () => {
    const world = town();
    expect(growthFactors(world).residential).toBeLessThan(1);
    world.milestone = 1;
    updateServices(world);
    expect(growthFactors(world).residential).toBe(1);
  });

  it('lässt ohne jede Versorgung bei normalen Steuern niemanden wegziehen', () => {
    for (const needs of Object.values(NEEDS)) {
      const missing = Object.values(needs).reduce((sum, weight) => sum + weight, 0);
      expect(1 - missing).toBeGreaterThanOrEqual(HAPPINESS.abandonBelow);
    }
    const world = town();
    const before = world.buildings.size;
    for (let month = 0; month < 12; month++) monthlyChanges(world);
    expect(world.buildings.size).toBe(before);
  });

  it('lässt bei hohen Steuern ohne Versorgung Gebäude verfallen', () => {
    const world = town();
    setTaxRate(world, 'residential', 15);
    updateServices(world);
    const before = world.buildings.size;
    for (let month = 0; month < 12; month++) monthlyChanges(world);
    expect(world.buildings.size).toBeLessThan(before);
    for (const cell of world.zoning.cells) {
      if (cell.building !== null) expect(world.buildings.has(cell.building) || world.services.has(cell.building)).toBe(true);
    }
  });

  it('rechnet mit dem höchsten Steuersatz des Monats, auch wenn er am letzten Tag gesenkt wird', () => {
    const dodge = (lowerOnLastDay: boolean): number => {
      const world = town();
      setTaxRate(world, 'residential', 15);
      setTaxRate(world, 'commercial', 15);
      setTaxRate(world, 'industrial', 15);
      for (let month = 0; month < 12; month++) {
        simulate(world, TICKS_PER_MONTH - 1);
        if (lowerOnLastDay) setTaxRate(world, 'residential', 10);
        simulate(world, 1);
        setTaxRate(world, 'residential', 15);
      }
      return [...world.buildings.values()].filter((building) => building.zone === 'residentialLow').length;
    };
    const honest = dodge(false);
    const tricky = dodge(true);
    const start = [...town().buildings.values()].filter((building) => building.zone === 'residentialLow').length;
    expect(honest).toBeLessThan(start);
    // Der Trick rettet die Häuser nicht: es ziehen ebenfalls welche weg.
    expect(tricky).toBeLessThan(start);
  });

  it('lässt gut versorgte Gebäude aufsteigen, aber nur bis zur erlaubten Stufe', () => {
    const world = town();
    world.milestone = 2;
    expect(levelCap(world, 'residential')).toBe(2);
    world.milestone = 1;
    expect(levelCap(world, 'residential')).toBe(1);
    world.milestone = 2;
    // Auf Stufe 2 zählen nur Strom und Wasser; beides reichlich bereitstellen.
    road(world, -200, 0, -200, 160);
    for (const z of [60, 84, 108, 132]) service(world, 'windTurbine', -188, z);
    for (const z of [60, 84, 108]) service(world, 'waterTower', -212, z);
    expect(world.city.happiness).toBe(1);
    const residents = world.stats.residents;
    for (let month = 0; month < 60; month++) monthlyChanges(world);
    for (const building of world.buildings.values()) {
      expect(building.level).toBeLessThanOrEqual(2);
      expect(building.capacity).toBe(Math.round(building.baseCapacity * (1 + HAPPINESS.capacityPerLevel * (building.level - 1))));
    }
    expect([...world.buildings.values()].some((building) => building.level === 2)).toBe(true);
    expect(world.stats.residents).toBeGreaterThan(residents);
  });
});

describe('Dienste im Budget', () => {
  it('rechnet den Unterhalt der Dienste in Vorschau und Abrechnung', () => {
    const world = createWorld();
    world.milestone = ALL_UNLOCKED;
    road(world, -100, 0, 100, 0);
    service(world, 'police', 0, 14);
    service(world, 'park', 60, 14);
    const month = forecast(world);
    expect(month.serviceUpkeep).toBe(300);
    expect(month.net).toBeCloseTo(-100 - 300, 6);
    const before = world.economy.money;
    simulate(world, TICKS_PER_MONTH);
    expect(world.economy.lastReport!.serviceUpkeep).toBeCloseTo(300, 6);
    expect(world.economy.money).toBeCloseTo(before - 400, 6);
  });

  it('zählt Dienste zum Besitz, den die Nothilfe berücksichtigt', () => {
    const world = createWorld();
    world.milestone = ALL_UNLOCKED;
    road(world, -100, 0, 100, 0);
    const roads = demolitionValue(world);
    service(world, 'police', 0, 14);
    expect(demolitionValue(world)).toBe(roads + 4500);
    expect(MONEY.start).toBeGreaterThan(0);
  });
});
