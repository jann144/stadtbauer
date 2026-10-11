import type { ZoneId } from '../config/zones';
import { SERVICE_TYPES } from '../config/services';
import { canAfford, earn, roadCost, roadRefund, serviceRefund, spend } from './economy/budget';
import { isRoadUnlocked, isServiceUnlocked, isZoneUnlocked } from './economy/milestones';
import { commitRoad, type RoadPlan } from './roads/builder';
import { removeSegment, segmentOf, shapeOf } from './roads/graph';
import {
  isPlanBuildable,
  placeService,
  removeBuilding,
  removeService,
  type ServicePlan,
} from './services/services';
import type { World } from './world';
import type { ZoneCell } from './zoning/cells';
import { paintZone, roadsChanged } from './zoning/growth';

/**
 * Was der Spieler tun kann, mit allen Spielregeln (Geld, Freischaltungen).
 * Die Werkzeuge rufen nur diese Funktionen auf, nie direkt das Straßennetz.
 */

/** Grund, warum eine Aktion verweigert wird: noch nicht freigeschaltet, der Platz ist belegt oder zu teuer. */
export type Refusal = 'locked' | 'blocked' | 'money';

export function roadPlanCost(plan: RoadPlan): number {
  return roadCost(plan.request.type, plan.shape.length);
}

/** Prüft Freischaltung und Geld für eine geplante Straße; null, wenn sie gebaut werden darf. */
export function refusalFor(world: World, plan: RoadPlan): Refusal | null {
  if (!isRoadUnlocked(world, plan.request.type)) return 'locked';
  if (!canAfford(world, roadPlanCost(plan))) return 'money';
  return null;
}

/** Baut und bezahlt eine geplante Straße. Liefert null bei Erfolg, sonst den Grund der Verweigerung. */
export function buildRoad(world: World, plan: RoadPlan): Refusal | null {
  const refusal = refusalFor(world, plan);
  if (refusal) return refusal;
  spend(world, roadPlanCost(plan));
  commitRoad(world.roads, plan);
  roadsChanged(world);
  return null;
}

/** Was der Abriss eines Straßenstücks zurückbringt. */
export function segmentRefund(world: World, segmentId: number): number {
  const segment = segmentOf(world.roads, segmentId);
  return roadRefund(segment.type, shapeOf(world.roads, segment).length);
}

/** Reißt ein Straßenstück ab, schreibt die Erstattung gut und liefert sie. */
export function demolishRoad(world: World, segmentId: number): number {
  const refund = segmentRefund(world, segmentId);
  removeSegment(world.roads, segmentId);
  earn(world, refund);
  roadsChanged(world);
  return refund;
}

/** Prüft Freischaltung, Platz und Geld für ein geplantes Dienstgebäude; null, wenn es gebaut werden darf. */
export function serviceRefusal(world: World, plan: ServicePlan): Refusal | null {
  if (!isServiceUnlocked(world, plan.type)) return 'locked';
  if (!isPlanBuildable(world, plan)) return 'blocked';
  if (!canAfford(world, SERVICE_TYPES[plan.type].cost)) return 'money';
  return null;
}

/** Baut und bezahlt ein geplantes Dienstgebäude. Liefert null bei Erfolg, sonst den Grund der Verweigerung. */
export function buildService(world: World, plan: ServicePlan): Refusal | null {
  const refusal = serviceRefusal(world, plan);
  if (refusal) return refusal;
  spend(world, SERVICE_TYPES[plan.type].cost);
  placeService(world, plan);
  return null;
}

/** Reißt ein Dienstgebäude ab, schreibt die Erstattung gut und liefert sie. */
export function demolishService(world: World, id: number): number {
  const service = world.services.get(id);
  if (!service) return 0;
  const refund = serviceRefund(service.type);
  removeService(world, id);
  earn(world, refund);
  return refund;
}

/** Reißt ein gewachsenes Gebäude ab. Das kostet nichts; bleibt die Zone, wächst dort wieder etwas. */
export function demolishBuilding(world: World, id: number): void {
  removeBuilding(world, id);
}

/** Wie `paintZone`, weist aber keine gesperrten Zonen aus. Entfernen (null) geht immer; Zonen kosten nichts. */
export function zoneArea(
  world: World,
  x: number,
  z: number,
  radius: number,
  zone: ZoneId | null,
  undo?: Map<ZoneCell, ZoneId | null>,
): boolean {
  if (zone !== null && !isZoneUnlocked(world, zone)) return false;
  return paintZone(world, x, z, radius, zone, undo);
}
