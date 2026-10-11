import type { ZoneId } from '../config/zones';
import type { World } from '../sim/world';
import type { ZoneCell } from '../sim/zoning/cells';
import { zoneArea } from '../sim/actions';
import { isZoneUnlocked } from '../sim/economy/milestones';
import { restoreZones } from '../sim/zoning/growth';
import { distance, lerp, type Vec2 } from '../util/vec2';
import type { Tool, ToolEnvironment } from './tool';

/** Gewählte Zone des Pinsels; 'none' entfernt Zonen. */
export type ZoneChoice = ZoneId | 'none';

/** Pinselgrößen als Radius in Metern. */
export const BRUSHES = { small: 5, large: 14 };
export type BrushId = keyof typeof BRUSHES;

/** Zonen ausweisen: Zellen durch Antippen oder Ziehen mit der gewählten Zone bemalen. */
export class ZoneTool implements Tool {
  zone: ZoneChoice = 'residentialLow';
  brush: BrushId = 'large';
  /** Stelle des Pinsels, für die Vorschau; null, solange kein Zeiger über der Karte ist. */
  pointer: Vec2 | null = null;
  /** Zellen, die der laufende Pinselstrich geändert hat, mit ihrer vorherigen Zone. */
  private readonly stroke = new Map<ZoneCell, ZoneId | null>();

  constructor(
    private readonly world: World,
    private readonly env: ToolEnvironment,
  ) {}

  get radius(): number {
    return BRUSHES[this.brush];
  }

  setZone(zone: ZoneChoice): void {
    if (zone !== 'none' && !isZoneUnlocked(this.world, zone)) return;
    this.zone = zone;
    this.env.changed();
  }

  setBrush(brush: BrushId): void {
    this.brush = brush;
    this.env.changed();
  }

  hover(ground: Vec2 | null): void {
    this.pointer = ground;
    this.env.changed();
  }

  tap(ground: Vec2): void {
    this.drag(ground, ground);
    // Ein Tupfer ist sofort fertig; es folgt kein Ende des Ziehens, das ihn abschließen würde.
    this.stroke.clear();
  }

  drag(from: Vec2, to: Vec2): void {
    const zone = this.zone === 'none' ? null : this.zone;
    // Auch bei schnellem Ziehen lückenlos malen: den Weg in Schritten von einem halben Pinsel abgehen.
    const steps = Math.max(1, Math.ceil(distance(from, to) / (this.radius / 2)));
    for (let i = 0; i <= steps; i++) {
      const point = lerp(from, to, i / steps);
      zoneArea(this.world, point.x, point.z, this.radius, zone, this.stroke);
    }
    this.pointer = to;
    this.env.changed();
  }

  /**
   * Ende eines Pinselstrichs. Wurde er unterbrochen (etwa weil der erste Finger einer Zwei-Finger-Geste
   * schon gemalt hat, bevor der zweite aufsetzte), wird er zurückgenommen.
   */
  dragEnd(interrupted: boolean): void {
    if (interrupted) restoreZones(this.world, this.stroke);
    this.stroke.clear();
    this.pointer = null;
    this.env.changed();
  }

  confirm(): void {}

  cancel(): void {
    this.stroke.clear();
    this.pointer = null;
    this.env.changed();
  }

  get hint(): string {
    if (this.world.zoning.cells.length === 0) return 'Baue zuerst eine Straße; Zonen liegen an Straßen.';
    return this.zone === 'none'
      ? 'Ziehe über Zellen, um ihre Zone zu entfernen.'
      : 'Ziehe über die Zellen neben einer Straße, um die Zone auszuweisen. Das kostet nichts.';
  }
}
