import type { ZoneKind } from './zones';

/**
 * Versorger und Dienste, die der Spieler selbst baut, und was sie für die Zufriedenheit bedeuten.
 * Neue Gebäude einfach als weiteren Eintrag in SERVICE_DATA ergänzen.
 */

/** Versorger zählen im ganzen zusammenhängenden Straßennetz: Leistung gegen Bedarf. */
export const UTILITIES = ['power', 'water', 'garbage'] as const;
export type UtilityCategory = (typeof UTILITIES)[number];

/** Dienste wirken nur im Einzugsbereich, gemessen als Weg entlang der Straßen. */
export const COVERAGE = ['police', 'fire', 'health', 'education', 'park'] as const;
export type CoverageCategory = (typeof COVERAGE)[number];

export type ServiceCategory = UtilityCategory | CoverageCategory;

export const CATEGORY_NAMES: Record<ServiceCategory, string> = {
  power: 'Strom',
  water: 'Wasser',
  garbage: 'Müllabfuhr',
  police: 'Polizei',
  fire: 'Feuerwehr',
  health: 'Gesundheit',
  education: 'Schule',
  park: 'Parks',
};

export interface ServiceType {
  name: string;
  category: ServiceCategory;
  /** Grundstück in Zellen: Breite entlang der Straße und Tiefe von ihr weg. */
  width: number;
  depth: number;
  /** Baukosten in Euro. */
  cost: number;
  /** Unterhalt je Monat in Euro. */
  upkeep: number;
  /** Nur Versorger: so viele Einwohner und Arbeitsplätze versorgt das Gebäude. */
  capacity?: number;
  /** Nur Dienste: Reichweite entlang der Straßen in Metern. */
  range?: number;
}

const SERVICE_DATA = {
  windTurbine: { name: 'Windrad', category: 'power', width: 2, depth: 2, cost: 2500, upkeep: 100, capacity: 200 },
  powerPlant: { name: 'Kraftwerk', category: 'power', width: 5, depth: 5, cost: 18000, upkeep: 700, capacity: 2000 },
  waterTower: { name: 'Wasserturm', category: 'water', width: 2, depth: 2, cost: 3000, upkeep: 120, capacity: 300 },
  waterWorks: { name: 'Wasserwerk', category: 'water', width: 4, depth: 4, cost: 16000, upkeep: 700, capacity: 2500 },
  landfill: { name: 'Müllhalde', category: 'garbage', width: 4, depth: 4, cost: 4000, upkeep: 200, capacity: 500 },
  police: { name: 'Polizeiwache', category: 'police', width: 3, depth: 3, cost: 6000, upkeep: 250, range: 600 },
  fireStation: { name: 'Feuerwache', category: 'fire', width: 3, depth: 3, cost: 6000, upkeep: 250, range: 600 },
  clinic: { name: 'Klinik', category: 'health', width: 3, depth: 4, cost: 8000, upkeep: 350, range: 700 },
  school: { name: 'Grundschule', category: 'education', width: 4, depth: 4, cost: 7000, upkeep: 300, range: 500 },
  park: { name: 'Park', category: 'park', width: 3, depth: 3, cost: 1500, upkeep: 50, range: 250 },
} satisfies Record<string, ServiceType>;

export type ServiceId = keyof typeof SERVICE_DATA;
export const SERVICE_TYPES: Record<ServiceId, ServiceType> = SERVICE_DATA;

/**
 * Wie viel Zufriedenheit (von 1) einem Gebäude fehlt, wenn ein Bedarf nicht gedeckt ist.
 * Ein Bedarf zählt erst, wenn es ein passendes Gebäude zu bauen gibt (siehe Meilensteine).
 * Die Summe je Zonenart bleibt unter 0.7: ohne jede Versorgung liegt die Zufriedenheit dann
 * noch über HAPPINESS.abandonBelow, und niemand zieht allein deshalb weg.
 */
export const NEEDS: Record<ZoneKind, Partial<Record<ServiceCategory, number>>> = {
  residential: { power: 0.12, water: 0.12, garbage: 0.08, police: 0.06, fire: 0.06, health: 0.07, education: 0.08, park: 0.06 },
  commercial: { power: 0.15, water: 0.1, garbage: 0.1, police: 0.12, fire: 0.1 },
  industrial: { power: 0.2, water: 0.12, garbage: 0.1, fire: 0.12 },
};

export const HAPPINESS = {
  /** Jeder Prozentpunkt Steuern über dem normalen Satz kostet so viel Zufriedenheit. */
  taxPenaltyPerPoint: 0.04,
  /** Wachstumsfaktor einer Zonenart bei Zufriedenheit 0; bei Zufriedenheit 1 ist er 1. */
  growthAtZero: 0.4,
  /** Ab dieser Zufriedenheit kann ein Gebäude aufsteigen; die Chance gilt je Monat. */
  levelUpAbove: 0.85,
  levelUpChance: 0.1,
  maxLevel: 3,
  /** Jede Stufe über der ersten bringt so viel mehr Einwohner bzw. Arbeitsplätze (0.3 = 30 %). */
  capacityPerLevel: 0.3,
  /** Unter dieser Zufriedenheit wird ein Gebäude mit dieser Chance je Monat verlassen. */
  abandonBelow: 0.3,
  abandonChance: 0.15,
};
