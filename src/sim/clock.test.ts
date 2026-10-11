import { describe, expect, it } from 'vitest';
import { TIME } from '../config/settings';
import { SimClock } from './clock';

describe('SimClock', () => {
  it('liefert bei einfacher Geschwindigkeit die Schritte pro Sekunde', () => {
    const clock = new SimClock();
    expect(clock.advance(1)).toBe(TIME.ticksPerSecond);
  });

  it('sammelt Bruchteile über mehrere Bilder', () => {
    const clock = new SimClock();
    const half = 0.5 / TIME.ticksPerSecond;
    expect(clock.advance(half)).toBe(0);
    expect(clock.advance(half)).toBe(1);
  });

  it('läuft bei höherer Geschwindigkeit entsprechend schneller', () => {
    const clock = new SimClock();
    clock.speed = 3;
    expect(clock.advance(0.1)).toBe(Math.floor(0.1 * 3 * TIME.ticksPerSecond));
  });

  it('steht in der Pause still', () => {
    const clock = new SimClock();
    clock.speed = 0;
    expect(clock.advance(5)).toBe(0);
  });

  it('meldet den verstrichenen Anteil des nächsten Schritts, auch in der Pause', () => {
    const clock = new SimClock();
    clock.advance(0.25 / TIME.ticksPerSecond);
    expect(clock.blend).toBeCloseTo(0.25, 9);
    // Beim Pausieren springt nichts: der Anteil bleibt, wo er war.
    clock.speed = 0;
    clock.advance(1);
    expect(clock.blend).toBeCloseTo(0.25, 9);
  });

  it('holt nach einem langen Hänger nicht unbegrenzt auf', () => {
    const clock = new SimClock();
    expect(clock.advance(60)).toBeLessThan(60 * TIME.ticksPerSecond);
    expect(clock.advance(0)).toBe(0);
  });
});
