import { MILESTONES, type Milestone } from '../config/milestones';
import { ROAD_TYPES } from '../config/roads';
import { SERVICE_TYPES } from '../config/services';
import { ZONE_TYPES } from '../config/zones';
import { formatMoney } from '../util/format';

/** Was eine Stufe Neues bringt, als kurze Aufzählung: freigeschaltete Straßen, Zonen und Dienste, höherer Kreditrahmen. */
export function describeUnlocks(milestone: Milestone): string[] {
  const news: string[] = [];
  for (const id of milestone.unlocks.roads ?? []) news.push(ROAD_TYPES[id].name);
  for (const id of milestone.unlocks.zones ?? []) news.push(ZONE_TYPES[id].name);
  for (const id of milestone.unlocks.services ?? []) news.push(SERVICE_TYPES[id].name);
  const before = MILESTONES[MILESTONES.indexOf(milestone) - 1]?.loanLimit ?? 0;
  if (milestone.loanLimit > before) news.push(`Kredite bis ${formatMoney(milestone.loanLimit)}`);
  return news;
}

/** Kurzer Vermerk an einer gesperrten Schaltfläche, etwa „ab 300 Einw.“. */
export function lockNote(level: number): string {
  return `ab ${MILESTONES[level].residents} Einw.`;
}
