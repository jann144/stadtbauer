import { GROWTH } from '../../config/balance';
import { ZONE_TYPES, type ZoneKind } from '../../config/zones';
import type { Building } from '../buildings';

export interface CityStats {
  residents: number;
  commercialJobs: number;
  industrialJobs: number;
}

/** Nachfrage je Zonenart von 0 (keine) bis 1 (sehr hoch). */
export type Demand = Record<ZoneKind, number>;

const NEUTRAL: Record<ZoneKind, number> = { residential: 1, commercial: 1, industrial: 1 };

/** Zählt Einwohner und Arbeitsplätze aller Gebäude. */
export function cityStats(buildings: Iterable<Building>): CityStats {
  const stats: CityStats = { residents: 0, commercialJobs: 0, industrialJobs: 0 };
  for (const building of buildings) {
    const kind = ZONE_TYPES[building.zone].kind;
    if (kind === 'residential') stats.residents += building.capacity;
    else if (kind === 'commercial') stats.commercialJobs += building.capacity;
    else stats.industrialJobs += building.capacity;
  }
  return stats;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Wohnraum ist gefragt, solange es mehr Arbeitsplätze als Arbeitskräfte gibt.
 * Gewerbe und Industrie sind gefragt, solange die Einwohner mehr Arbeitsplätze brauchen, als es gibt.
 * `factor` vervielfacht die Nachfrage je Zonenart, etwa durch niedrige oder hohe Steuern.
 */
export function demandFor(stats: CityStats, factor: Record<ZoneKind, number> = NEUTRAL): Demand {
  const workers = stats.residents * GROWTH.workforceShare;
  const jobs = stats.commercialJobs + stats.industrialJobs;
  const commercialNeed = stats.residents * GROWTH.commercialJobsPerResident;
  const industrialNeed = stats.residents * GROWTH.industrialJobsPerResident;
  const residential = clamp01(GROWTH.baseResidentialDemand + (jobs - workers) / Math.max(20, workers));
  const commercial = clamp01((commercialNeed - stats.commercialJobs) / Math.max(10, commercialNeed));
  const industrial = clamp01((industrialNeed - stats.industrialJobs) / Math.max(10, industrialNeed));
  return {
    residential: clamp01(residential * factor.residential),
    commercial: clamp01(commercial * factor.commercial),
    industrial: clamp01(industrial * factor.industrial),
  };
}
