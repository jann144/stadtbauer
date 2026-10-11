import { TIME } from '../config/settings';

/** Obergrenze, damit die Simulation nach einem Hänger nicht endlos aufholt. */
const MAX_STEPS_PER_FRAME = 12;

/** Übersetzt vergangene Echtzeit in eine feste Anzahl von Simulationsschritten. */
export class SimClock {
  /** Geschwindigkeitsfaktor; 0 bedeutet Pause. */
  speed = 1;
  private pending = 0;

  /** Liefert, wie viele Simulationsschritte für `realSeconds` fällig sind. */
  advance(realSeconds: number): number {
    if (this.speed === 0) return 0;
    this.pending += realSeconds * this.speed * TIME.ticksPerSecond;
    const due = Math.floor(this.pending);
    if (due > MAX_STEPS_PER_FRAME) {
      this.pending = 0;
      return MAX_STEPS_PER_FRAME;
    }
    this.pending -= due;
    return due;
  }

  /**
   * Wie weit der nächste Simulationsschritt schon verstrichen ist (0 bis 1).
   * Damit blendet die Darstellung Bewegungen zwischen zwei Schritten weich über.
   */
  get blend(): number {
    return this.pending;
  }
}
