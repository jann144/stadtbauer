import { describe, expect, it } from 'vitest';
import { TIME } from '../config/settings';
import { buildRoad, demolishRoad } from './actions';
import { takeLoan } from './economy/budget';
import { isRoadUnlocked, isServiceUnlocked, isZoneUnlocked } from './economy/milestones';
import { planRoad } from './roads/builder';
import { isNeedActive } from './services/services';
import { createWorld, stepWorld, type World } from './world';

const TICKS_PER_MONTH = TIME.ticksPerDay * TIME.daysPerMonth;

function plan(world: World, type: 'small' | 'medium' = 'small') {
  return planRoad(world.roads, { start: { x: 0, z: 0 }, end: { x: 200, z: 0 }, type });
}

function simulate(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) stepWorld(world);
}

describe('Freies Bauen', () => {
  it('baut mit unendlich Geld auch ohne Geld, und der Kontostand bleibt stehen', () => {
    const world = createWorld();
    world.economy.money = 0;
    expect(buildRoad(world, plan(world))).toBe('money');

    world.sandbox.infiniteMoney = true;
    expect(buildRoad(world, plan(world))).toBeNull();
    expect(world.roads.segments.size).toBe(1);
    expect(world.economy.money).toBe(0);

    // Auch der Abriss bringt nichts ein, sonst ließe sich so Geld erzeugen.
    demolishRoad(world, [...world.roads.segments.keys()][0]);
    expect(world.roads.segments.size).toBe(0);
    expect(world.economy.money).toBe(0);
  });

  it('bucht mit unendlich Geld weder Unterhalt noch Nothilfe, danach wieder alles', () => {
    const world = createWorld();
    expect(buildRoad(world, plan(world))).toBeNull();
    world.sandbox.infiniteMoney = true;
    const before = world.economy.money;
    simulate(world, TICKS_PER_MONTH * 2);
    expect(world.economy.money).toBe(before);
    expect(world.economy.lastReport?.aid).toBe(0);

    world.sandbox.infiniteMoney = false;
    simulate(world, TICKS_PER_MONTH);
    expect(world.economy.money).toBeLessThan(before);
  });

  it('gibt mit unendlich Geld keinen Kredit, weil nur die Schuld bliebe', () => {
    const world = createWorld();
    world.milestone = 2;
    world.sandbox.infiniteMoney = true;
    expect(takeLoan(world, 5000)).toBe(false);
    expect(world.economy.loan.remaining).toBe(0);
    world.sandbox.infiniteMoney = false;
    expect(takeLoan(world, 5000)).toBe(true);
  });

  it('öffnet mit „alles freischalten“ jede Straße, Zone und jeden Dienst', () => {
    const world = createWorld();
    world.economy.money = 1e6;
    expect(isRoadUnlocked(world, 'medium')).toBe(false);
    expect(isZoneUnlocked(world, 'residentialHigh')).toBe(false);
    expect(isServiceUnlocked(world, 'powerPlant')).toBe(false);
    expect(buildRoad(world, plan(world, 'medium'))).toBe('locked');

    world.sandbox.unlockAll = true;
    expect(isRoadUnlocked(world, 'medium')).toBe(true);
    expect(isZoneUnlocked(world, 'residentialHigh')).toBe(true);
    expect(isServiceUnlocked(world, 'powerPlant')).toBe(true);
    expect(buildRoad(world, plan(world, 'medium'))).toBeNull();
  });

  it('weckt mit „alles freischalten“ keine Ansprüche der Einwohner', () => {
    const world = createWorld();
    world.sandbox.unlockAll = true;
    expect(isNeedActive(world, 'power')).toBe(false);
    expect(isNeedActive(world, 'police')).toBe(false);
    // Erst die erreichte Stufe zählt: „Dorf“ bringt das Windrad und damit den Strombedarf.
    world.milestone = 2;
    expect(isNeedActive(world, 'power')).toBe(true);
    expect(isNeedActive(world, 'police')).toBe(false);
  });
});
