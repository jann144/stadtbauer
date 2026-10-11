import { MILESTONES, type Milestone } from '../../config/milestones';
import type { RoadTypeId } from '../../config/roads';
import type { ServiceId } from '../../config/services';
import type { ZoneId } from '../../config/zones';
import type { World } from '../world';
import { earn } from './budget';

/** Stufe (Index in MILESTONES), die einen Straßentyp freischaltet; 0, wenn er in keiner Stufe steht. */
export function roadUnlockLevel(type: RoadTypeId): number {
  const level = MILESTONES.findIndex((milestone) => milestone.unlocks.roads?.includes(type));
  return Math.max(0, level);
}

/** Stufe, die eine Zonenart freischaltet; 0, wenn sie in keiner Stufe steht. */
export function zoneUnlockLevel(zone: ZoneId): number {
  const level = MILESTONES.findIndex((milestone) => milestone.unlocks.zones?.includes(zone));
  return Math.max(0, level);
}

/** Stufe, die einen Versorger oder Dienst freischaltet; 0, wenn er in keiner Stufe steht. */
export function serviceUnlockLevel(type: ServiceId): number {
  const level = MILESTONES.findIndex((milestone) => milestone.unlocks.services?.includes(type));
  return Math.max(0, level);
}

/** Ob ein Versorger oder Dienst gebaut werden darf: Stufe erreicht oder „alles freischalten“ an. */
export function isServiceUnlocked(world: World, type: ServiceId): boolean {
  return world.sandbox.unlockAll || isServiceReached(world, type);
}

/**
 * Ob die Stufe für einen Dienst wirklich erreicht ist, ohne den Sandbox-Schalter.
 * Danach richtet sich, was die Einwohner erwarten: „alles freischalten“ soll nicht alle Ansprüche auf einmal wecken.
 */
export function isServiceReached(world: World, type: ServiceId): boolean {
  return world.milestone >= serviceUnlockLevel(type);
}

export function isRoadUnlocked(world: World, type: RoadTypeId): boolean {
  return world.sandbox.unlockAll || world.milestone >= roadUnlockLevel(type);
}

export function isZoneUnlocked(world: World, zone: ZoneId): boolean {
  return world.sandbox.unlockAll || world.milestone >= zoneUnlockLevel(zone);
}

/** Die nächste noch nicht erreichte Stufe, oder null auf der höchsten. */
export function nextMilestone(world: World): Milestone | null {
  return MILESTONES[world.milestone + 1] ?? null;
}

/**
 * Hebt die Stufe an, solange die Einwohnerzahl für die nächste reicht, und zahlt jede Prämie einmal.
 * Die Stufe sinkt nie wieder, auch wenn Einwohner wegziehen.
 */
export function reachMilestones(world: World): void {
  for (let next = nextMilestone(world); next && world.stats.residents >= next.residents; next = nextMilestone(world)) {
    world.milestone++;
    earn(world, next.reward);
  }
}
