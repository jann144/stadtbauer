import { GROWTH } from '../config/balance';
import { TIME } from '../config/settings';
import type { Building, ServiceBuilding } from './buildings';
import { createEconomy, settleDay, settleMonth, type Economy } from './economy/budget';
import type { CityStats, Demand } from './economy/demand';
import { reachMilestones } from './economy/milestones';
import { createNetwork, type RoadNetwork } from './roads/graph';
import { emptyCityServices, monthlyChanges, updateServices, type CityServices } from './services/services';
import { createTraffic, endTrafficDay, stepTraffic, type Traffic } from './traffic/traffic';
import { createGrid, type ZoneGrid } from './zoning/cells';
import { growCity } from './zoning/growth';

/** Gesamter Spielzustand. Enthält nur einfache Daten, damit er sich speichern lässt. */
export interface World {
  /** Anzahl der bisher simulierten Schritte. */
  tick: number;
  /** Zustand des Zufallsgenerators der Simulation. */
  rng: number;
  roads: RoadNetwork;
  zoning: ZoneGrid;
  buildings: Map<number, Building>;
  /** Vom Spieler gebaute Versorger und Dienste; sie teilen sich die Nummern mit den Gebäuden. */
  services: Map<number, ServiceBuilding>;
  nextBuildingId: number;
  /** Erhöht sich, wenn Gebäude entstehen oder verschwinden; daran erkennt die Darstellung Änderungen. */
  buildingsVersion: number;
  /** Erhöht sich, wenn Dienste gebaut oder abgerissen werden. */
  servicesVersion: number;
  /** Versorgung, Einzugsbereiche und Zufriedenheit im Überblick; wird jeden Spieltag neu berechnet. */
  city: CityServices;
  stats: CityStats;
  demand: Demand;
  economy: Economy;
  traffic: Traffic;
  /** Höchste erreichte Stufe (Index in MILESTONES); sinkt nie. */
  milestone: number;
  sandbox: Sandbox;
}

/** Schalter zum freien Bauen ohne Spielregeln. */
export interface Sandbox {
  /** Bauen kostet nichts, und der Kontostand bleibt stehen. */
  infiniteMoney: boolean;
  /** Alle Straßen, Zonen und Dienste sind sofort verfügbar. */
  unlockAll: boolean;
}

export interface GameDate {
  day: number;
  month: number;
  year: number;
}

const TICKS_PER_MONTH = TIME.ticksPerDay * TIME.daysPerMonth;

export function createWorld(): World {
  return {
    tick: 0,
    rng: 20251010,
    roads: createNetwork(),
    zoning: createGrid(),
    buildings: new Map(),
    services: new Map(),
    nextBuildingId: 1,
    buildingsVersion: 0,
    servicesVersion: 0,
    city: emptyCityServices(),
    stats: { residents: 0, commercialJobs: 0, industrialJobs: 0 },
    demand: { residential: 0, commercial: 0, industrial: 0 },
    economy: createEconomy(),
    traffic: createTraffic(),
    milestone: 0,
    sandbox: { infiniteMoney: false, unlockAll: false },
  };
}

/** Rechnet die Simulation um genau einen Schritt weiter. */
export function stepWorld(world: World): void {
  world.tick++;
  stepTraffic(world);
  if (world.tick % GROWTH.interval === 0) {
    growCity(world);
    reachMilestones(world);
  }
  if (world.tick % TIME.ticksPerDay === 0) {
    endTrafficDay(world);
    updateServices(world);
    settleDay(world);
  }
  if (world.tick % TICKS_PER_MONTH === 0) {
    // Erst Aufstieg und Wegzug (sie brauchen die Buchungen des Monats), dann der Abschluss, der sie leert.
    monthlyChanges(world);
    settleMonth(world);
  }
}

export function dateAt(tick: number): GameDate {
  const days = Math.floor(tick / TIME.ticksPerDay);
  const months = Math.floor(days / TIME.daysPerMonth);
  return {
    day: (days % TIME.daysPerMonth) + 1,
    month: (months % TIME.monthsPerYear) + 1,
    year: TIME.startYear + Math.floor(months / TIME.monthsPerYear),
  };
}
