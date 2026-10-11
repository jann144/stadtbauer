import { TAX } from '../../config/economy';
import {
  COVERAGE,
  HAPPINESS,
  NEEDS,
  SERVICE_TYPES,
  UTILITIES,
  type CoverageCategory,
  type ServiceCategory,
  type ServiceId,
  type UtilityCategory,
} from '../../config/services';
import { WORLD } from '../../config/settings';
import { CONGESTION } from '../../config/traffic';
import { ZONE_TYPES, type ZoneKind } from '../../config/zones';
import type { Vec2 } from '../../util/vec2';
import { isLotValid, type Building, type Lot, type ServiceBuilding } from '../buildings';
import { cityStats } from '../economy/demand';
import { isServiceReached } from '../economy/milestones';
import { nextRandom } from '../random';
import { congestion } from '../traffic/traffic';
import type { World } from '../world';
import { cellAt, cellsNear, type ZoneCell } from '../zoning/cells';
import { isLotFree, lotFromCells, occupy, vacate } from '../zoning/lots';
import { lotAccess, reachFrom, roadComponents, roadDistance, type Access } from './network';

const CELL = WORLD.cellSize;
const KINDS: ZoneKind[] = ['residential', 'commercial', 'industrial'];

/** Überblick über Versorgung, Dienste und Zufriedenheit der ganzen Stadt, für Anzeige und Wachstum. */
export interface CityServices {
  /**
   * Leistung und Bedarf der Versorger, über alle Teilnetze zusammengezählt. `served` ist der gedeckte Bedarf:
   * Leistung in einem Netz ohne Verbindung zu den Abnehmern zählt dort nicht mit.
   */
  utilities: Record<UtilityCategory, { supply: number; demand: number; served: number }>;
  /** Anteil der Gebäude mit diesem Bedarf, die ein Dienst erreicht (0 bis 1). */
  coverage: Record<CoverageCategory, number>;
  /** Anteil der Gebäude, die an einer überlasteten Straße liegen (0 bis 1). */
  congested: number;
  /** Mittlere Zufriedenheit aller Gebäude, gewichtet nach ihrer Größe; 1, solange es keine gibt. */
  happiness: number;
  /** Mittlere Zufriedenheit je Zonenart; sie bestimmt, wie gern dort Neues entsteht. */
  happinessByKind: Record<ZoneKind, number>;
}

export function emptyCityServices(): CityServices {
  return {
    utilities: {
      power: { supply: 0, demand: 0, served: 0 },
      water: { supply: 0, demand: 0, served: 0 },
      garbage: { supply: 0, demand: 0, served: 0 },
    },
    coverage: { police: 1, fire: 1, health: 1, education: 1, park: 1 },
    congested: 0,
    happiness: 1,
    happinessByKind: { residential: 1, commercial: 1, industrial: 1 },
  };
}

/** Ein Bedarf zählt, sobald die Stadt die Stufe erreicht hat, die ein passendes Gebäude freischaltet. */
export function isNeedActive(world: World, category: ServiceCategory): boolean {
  return (Object.keys(SERVICE_TYPES) as ServiceId[]).some(
    (id) => SERVICE_TYPES[id].category === category && isServiceReached(world, id),
  );
}

/** Höchste Stufe, die Gebäude einer Zonenart erreichen können: 2 mit den ersten Diensten, die höchste mit allen. */
export function levelCap(world: World, kind: ZoneKind): number {
  const needs = Object.keys(NEEDS[kind]) as ServiceCategory[];
  const active = needs.filter((category) => isNeedActive(world, category)).length;
  if (active === 0) return 1;
  return active === needs.length ? HAPPINESS.maxLevel : Math.min(2, HAPPINESS.maxLevel);
}

// --- Bauen und Abreißen ---

/** Ein geplanter Versorger oder Dienst an einer bestimmten Stelle. */
export interface ServicePlan {
  type: ServiceId;
  /** Lage des Grundstücks; die Id wird erst beim Bauen vergeben. */
  lot: Lot;
  /** Ob dort beim Planen gebaut werden konnte; vor dem Bauen prüft `isPlanBuildable` noch einmal. */
  valid: boolean;
}

/**
 * Kann der Plan jetzt gebaut werden: alle Zellen frei und keine Straße im Weg?
 * Zwischen Planen und Bauen läuft das Spiel weiter; an der Stelle kann inzwischen ein Haus stehen.
 */
export function isPlanBuildable(world: World, plan: ServicePlan): boolean {
  return isLotFree(world.zoning, plan.lot) && isLotValid(world.roads, plan.lot);
}

/**
 * Plant ein Dienstgebäude am Straßenrand nächst dem Punkt. Liefert null, wenn dort kein
 * Bauland in der nötigen Größe liegt.
 */
export function planService(world: World, type: ServiceId, ground: Vec2): ServicePlan | null {
  const spec = SERVICE_TYPES[type];
  let anchor: ZoneCell | null = null;
  let nearest = Infinity;
  for (const cell of cellsNear(world.zoning, ground, CELL * 1.5)) {
    const gap = Math.hypot(cell.x - ground.x, cell.z - ground.z);
    if (gap < nearest) {
      nearest = gap;
      anchor = cell;
    }
  }
  if (!anchor) return null;

  // Das Grundstück liegt mittig um die angezielte Spalte und reicht von der Straße aus in die Tiefe.
  const left = anchor.column - Math.floor((spec.width - 1) / 2);
  const cells: ZoneCell[] = [];
  for (let column = left; column < left + spec.width; column++) {
    for (let row = 0; row < spec.depth; row++) {
      const cell = cellAt(world.zoning, anchor.segment, anchor.side, column, row);
      if (!cell) return null;
      cells.push(cell);
    }
  }
  const lot: Lot = { id: 0, ...lotFromCells(cells, spec.width), width: spec.width, depth: spec.depth };
  const plan: ServicePlan = { type, lot, valid: false };
  plan.valid = isPlanBuildable(world, plan);
  return plan;
}

/** Baut ein geplantes Dienstgebäude, ohne Geld und Freischaltung zu prüfen (das tun die Aktionen). */
export function placeService(world: World, plan: ServicePlan): ServiceBuilding {
  const service: ServiceBuilding = { ...plan.lot, id: world.nextBuildingId++, type: plan.type };
  world.services.set(service.id, service);
  occupy(world.zoning, service);
  world.zoning.version++;
  world.servicesVersion++;
  updateServices(world);
  return service;
}

export function removeService(world: World, id: number): void {
  const service = world.services.get(id);
  if (!service) return;
  world.services.delete(id);
  vacate(world.zoning, service);
  world.servicesVersion++;
  updateServices(world);
}

/** Entfernt ein gewachsenes Gebäude; seine Zellen behalten ihre Zone und können neu bebaut werden. */
export function removeBuilding(world: World, id: number): void {
  const building = world.buildings.get(id);
  if (!building) return;
  world.buildings.delete(id);
  vacate(world.zoning, building);
  world.buildingsVersion++;
  world.stats = cityStats(world.buildings.values());
}

// --- Versorgung, Einzugsbereiche und Zufriedenheit ---

/**
 * Rechnet neu aus, wie gut jedes Gebäude versorgt ist, und daraus seine Zufriedenheit.
 * Versorger: Leistung gegen Bedarf im selben zusammenhängenden Straßennetz.
 * Dienste: ein Gebäude ist erreicht, wenn der Weg entlang der Straßen kürzer als die Reichweite ist.
 */
export function updateServices(world: World): void {
  const net = world.roads;
  const components = roadComponents(net);
  const componentOf = (access: Access | null): number | null => {
    const segment = access && net.segments.get(access.segment);
    return segment ? (components.get(segment.from) ?? null) : null;
  };
  const activeUtilities = UTILITIES.filter((category) => isNeedActive(world, category));
  const activeCoverage = COVERAGE.filter((category) => isNeedActive(world, category));

  // Versorger: Leistung und Bedarf je Teilnetz.
  const supply = new Map<string, number>();
  const demand = new Map<string, number>();
  const summary = emptyCityServices();
  const reached = new Map<CoverageCategory, Set<number>>();
  for (const category of COVERAGE) reached.set(category, new Set());

  for (const service of world.services.values()) {
    const spec = SERVICE_TYPES[service.type];
    const access = lotAccess(world, service);
    if (!access) continue;
    if (spec.capacity !== undefined) {
      const key = `${componentOf(access)}|${spec.category}`;
      supply.set(key, (supply.get(key) ?? 0) + spec.capacity);
      summary.utilities[spec.category as UtilityCategory].supply += spec.capacity;
    }
    if (spec.range !== undefined) {
      const reach = reachFrom(net, access, spec.range);
      const set = reached.get(spec.category as CoverageCategory)!;
      for (const building of world.buildings.values()) {
        if (set.has(building.id)) continue;
        const to = lotAccess(world, building);
        if (to && roadDistance(net, access, reach, to) <= spec.range) set.add(building.id);
      }
    }
  }
  for (const building of world.buildings.values()) {
    const component = componentOf(lotAccess(world, building));
    const needs = NEEDS[ZONE_TYPES[building.zone].kind];
    for (const category of activeUtilities) {
      if (needs[category] === undefined) continue;
      const key = `${component}|${category}`;
      demand.set(key, (demand.get(key) ?? 0) + building.capacity);
      summary.utilities[category].demand += building.capacity;
    }
  }

  for (const [key, wanted] of demand) {
    const category = key.slice(key.indexOf('|') + 1) as UtilityCategory;
    summary.utilities[category].served += Math.min(wanted, supply.get(key) ?? 0);
  }

  // Zufriedenheit je Gebäude: 1, minus jeder ungedeckte Bedarf, minus zu hohe Steuern.
  const total: Record<ZoneKind, { weight: number; sum: number }> = {
    residential: { weight: 0, sum: 0 },
    commercial: { weight: 0, sum: 0 },
    industrial: { weight: 0, sum: 0 },
  };
  let jammed = 0;
  const wanting: Record<CoverageCategory, { all: number; reached: number }> = {
    police: { all: 0, reached: 0 },
    fire: { all: 0, reached: 0 },
    health: { all: 0, reached: 0 },
    education: { all: 0, reached: 0 },
    park: { all: 0, reached: 0 },
  };
  for (const building of world.buildings.values()) {
    const kind = ZONE_TYPES[building.zone].kind;
    const needs = NEEDS[kind];
    const component = componentOf(lotAccess(world, building));
    let happiness = 1;
    for (const category of activeUtilities) {
      const weight = needs[category];
      if (weight === undefined) continue;
      const key = `${component}|${category}`;
      const share = Math.min(1, (supply.get(key) ?? 0) / Math.max(1, demand.get(key) ?? 0));
      happiness -= weight * (1 - share);
    }
    for (const category of activeCoverage) {
      const weight = needs[category];
      if (weight === undefined) continue;
      const isReached = reached.get(category)!.has(building.id);
      wanting[category].all++;
      if (isReached) wanting[category].reached++;
      else happiness -= weight;
    }
    happiness -= Math.max(0, world.economy.taxRate[kind] - TAX.normalRate) * HAPPINESS.taxPenaltyPerPoint;
    const jam = congestionPenalty(world, lotAccess(world, building));
    if (jam > 0) jammed++;
    happiness -= jam;
    building.happiness = Math.min(1, Math.max(0, happiness));
    total[kind].weight += building.capacity;
    total[kind].sum += building.happiness * building.capacity;
  }

  const weight = total.residential.weight + total.commercial.weight + total.industrial.weight;
  const sum = total.residential.sum + total.commercial.sum + total.industrial.sum;
  summary.happiness = weight > 0 ? sum / weight : 1;
  for (const kind of KINDS) {
    // Gibt es von einer Zonenart noch nichts, gilt für sie die Stimmung der ganzen Stadt.
    summary.happinessByKind[kind] = total[kind].weight > 0 ? total[kind].sum / total[kind].weight : summary.happiness;
  }
  for (const category of COVERAGE) {
    summary.coverage[category] = wanting[category].all > 0 ? wanting[category].reached / wanting[category].all : 1;
  }
  summary.congested = world.buildings.size > 0 ? jammed / world.buildings.size : 0;
  world.city = summary;
}

/** Abzug von der Zufriedenheit eines Gebäudes, dessen Straße überlastet ist: 0 bei freier Fahrt. */
function congestionPenalty(world: World, access: Access | null): number {
  if (!access) return 0;
  const over = (congestion(world, access.segment) - CONGESTION.annoysAbove) / (CONGESTION.worstAt - CONGESTION.annoysAbove);
  return CONGESTION.penalty * Math.min(1, Math.max(0, over));
}

/**
 * Einmal im Monat: sehr zufriedene Gebäude können eine Stufe aufsteigen (mehr Einwohner bzw. Arbeitsplätze),
 * sehr unzufriedene werden verlassen. Wer nichts davon erfüllt, verbraucht keinen Zufall.
 */
export function monthlyChanges(world: World): void {
  let changed = false;
  const { taxRate, book } = world.economy;
  for (const building of [...world.buildings.values()]) {
    // Es zählt der höchste Steuersatz des Monats: wer nur am letzten Tag senkt, entgeht den Folgen nicht.
    const kind = ZONE_TYPES[building.zone].kind;
    const dodged = Math.max(0, book.peakTax[kind] - Math.max(taxRate[kind], TAX.normalRate));
    const happiness = building.happiness - dodged * HAPPINESS.taxPenaltyPerPoint;
    if (happiness < HAPPINESS.abandonBelow) {
      if (nextRandom(world) < HAPPINESS.abandonChance) {
        world.buildings.delete(building.id);
        vacate(world.zoning, building);
        changed = true;
      }
    } else if (happiness >= HAPPINESS.levelUpAbove && building.level < levelCap(world, kind)) {
      if (nextRandom(world) < HAPPINESS.levelUpChance) {
        building.level++;
        building.capacity = capacityAt(building, building.level);
        changed = true;
      }
    }
  }
  if (!changed) return;
  world.buildingsVersion++;
  world.stats = cityStats(world.buildings.values());
  updateServices(world);
}

/** Einwohner bzw. Arbeitsplätze eines Gebäudes auf einer bestimmten Stufe. */
export function capacityAt(building: Building, level: number): number {
  return Math.round(building.baseCapacity * (1 + HAPPINESS.capacityPerLevel * (level - 1)));
}
