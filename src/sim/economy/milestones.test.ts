import { describe, expect, it } from 'vitest';
import { MONEY, TAX } from '../../config/economy';
import { MILESTONES } from '../../config/milestones';
import { TIME } from '../../config/settings';
import { zoneArea } from '../actions';
import { commitRoad, planRoad } from '../roads/builder';
import { createWorld, stepWorld } from '../world';
import { paintZone, roadsChanged } from '../zoning/growth';
import { loanLimit, setTaxRate } from './budget';
import { isRoadUnlocked, isZoneUnlocked, nextMilestone, reachMilestones } from './milestones';

function townWithRoad() {
  const world = createWorld();
  commitRoad(world.roads, planRoad(world.roads, { start: { x: -100, z: 0 }, end: { x: 100, z: 0 }, type: 'small' }));
  roadsChanged(world);
  return world;
}

describe('Meilensteine', () => {
  it('gibt am Anfang nur die kleine Straße und lockeres Wohnen frei', () => {
    const world = createWorld();
    expect(isRoadUnlocked(world, 'small')).toBe(true);
    expect(isRoadUnlocked(world, 'medium')).toBe(false);
    expect(isZoneUnlocked(world, 'residentialLow')).toBe(true);
    expect(isZoneUnlocked(world, 'commercial')).toBe(false);
    expect(isZoneUnlocked(world, 'industrial')).toBe(false);
    expect(isZoneUnlocked(world, 'residentialHigh')).toBe(false);
    expect(loanLimit(world)).toBe(0);
  });

  it('schaltet frei, hebt den Kreditrahmen und zahlt die Prämie', () => {
    const world = createWorld();
    world.stats.residents = MILESTONES[1].residents;
    reachMilestones(world);
    expect(world.milestone).toBe(1);
    expect(world.economy.money).toBe(MONEY.start + MILESTONES[1].reward);
    expect(isZoneUnlocked(world, 'commercial')).toBe(true);
    expect(isZoneUnlocked(world, 'industrial')).toBe(true);
    expect(nextMilestone(world)).toBe(MILESTONES[2]);
  });

  it('schreibt übersprungene Stufen alle gut', () => {
    const world = createWorld();
    world.stats.residents = MILESTONES[3].residents;
    reachMilestones(world);
    expect(world.milestone).toBe(3);
    const rewards = MILESTONES[1].reward + MILESTONES[2].reward + MILESTONES[3].reward;
    expect(world.economy.money).toBe(MONEY.start + rewards);
    expect(isRoadUnlocked(world, 'medium')).toBe(true);
    expect(loanLimit(world)).toBe(MILESTONES[3].loanLimit);
  });

  it('zahlt eine Prämie kein zweites Mal, wenn Einwohner wegziehen und wiederkommen', () => {
    const world = createWorld();
    world.stats.residents = 150;
    reachMilestones(world);
    const money = world.economy.money;
    world.stats.residents = 0;
    reachMilestones(world);
    expect(world.milestone).toBe(2);
    world.stats.residents = 150;
    reachMilestones(world);
    expect(world.economy.money).toBe(money);
  });

  it('bleibt auf der höchsten Stufe stehen', () => {
    const world = createWorld();
    world.stats.residents = 1e9;
    reachMilestones(world);
    expect(world.milestone).toBe(MILESTONES.length - 1);
    expect(nextMilestone(world)).toBeNull();
  });

  it('hat streng steigende Schwellen und nennt nichts doppelt', () => {
    const roads: string[] = [];
    const zones: string[] = [];
    MILESTONES.forEach((milestone, index) => {
      if (index > 0) expect(milestone.residents).toBeGreaterThan(MILESTONES[index - 1].residents);
      roads.push(...(milestone.unlocks.roads ?? []));
      zones.push(...(milestone.unlocks.zones ?? []));
    });
    expect(new Set(roads).size).toBe(roads.length);
    expect(new Set(zones).size).toBe(zones.length);
    expect(MILESTONES[0].residents).toBe(0);
  });

  it('erreicht die zweite Stufe allein mit lockerem Wohnen, auch beim höchsten Steuersatz', () => {
    const world = townWithRoad();
    for (let x = -96; x <= 96; x += 8) expect(zoneArea(world, x, -20, 14, 'residentialLow')).toBeDefined();
    setTaxRate(world, 'residential', TAX.maxRate);
    for (let i = 0; i < TIME.ticksPerDay * TIME.daysPerMonth * 6 && world.milestone === 0; i++) stepWorld(world);
    expect(world.milestone).toBeGreaterThanOrEqual(1);
  });

  it('weist gesperrte Zonen nicht aus, entfernt aber immer', () => {
    const world = townWithRoad();
    expect(zoneArea(world, 0, 12, 14, 'commercial')).toBe(false);
    expect(world.zoning.cells.every((cell) => cell.zone === null)).toBe(true);

    paintZone(world, 0, 12, 14, 'commercial');
    expect(world.zoning.cells.some((cell) => cell.zone === 'commercial')).toBe(true);
    expect(zoneArea(world, 0, 12, 14, null)).toBe(true);
    expect(world.zoning.cells.every((cell) => cell.zone === null)).toBe(true);

    world.milestone = 1;
    expect(zoneArea(world, 0, 12, 14, 'commercial')).toBe(true);
  });
});
