import { describe, expect, it } from 'vitest';
import { TIME } from '../config/settings';
import { createWorld, dateAt, stepWorld } from './world';

const TICKS_PER_MONTH = TIME.ticksPerDay * TIME.daysPerMonth;

describe('Spielzeit', () => {
  it('beginnt am 1. Januar des Startjahres', () => {
    expect(dateAt(0)).toEqual({ day: 1, month: 1, year: TIME.startYear });
  });

  it('wechselt nach einem vollen Tag auf den nächsten', () => {
    expect(dateAt(TIME.ticksPerDay - 1).day).toBe(1);
    expect(dateAt(TIME.ticksPerDay).day).toBe(2);
  });

  it('wechselt Monat und Jahr', () => {
    expect(dateAt(TICKS_PER_MONTH)).toEqual({ day: 1, month: 2, year: TIME.startYear });
    expect(dateAt(TICKS_PER_MONTH * TIME.monthsPerYear)).toEqual({
      day: 1,
      month: 1,
      year: TIME.startYear + 1,
    });
  });

  it('zählt pro Schritt genau einen Tick weiter', () => {
    const world = createWorld();
    stepWorld(world);
    stepWorld(world);
    expect(world.tick).toBe(2);
  });
});
