import { DEMOLITION } from '../config/economy';
import { SERVICE_TYPES } from '../config/services';
import { demolishBuilding, demolishRoad, demolishService, segmentRefund } from '../sim/actions';
import { onLot } from '../sim/buildings';
import { serviceRefund } from '../sim/economy/budget';
import { pickSegment } from '../sim/roads/snap';
import type { World } from '../sim/world';
import { formatMoney } from '../util/format';
import type { Vec2 } from '../util/vec2';
import type { Tool, ToolEnvironment } from './tool';

/** Was abgerissen werden soll: ein Straßenstück, ein gewachsenes Gebäude oder ein Dienstgebäude. */
export interface BulldozeTarget {
  kind: 'road' | 'building' | 'service';
  id: number;
}

/** Abriss: eine Straße oder ein Gebäude wählen und entfernen. */
export class BulldozeTool implements Tool {
  /** Das Ziel unter dem Zeiger bzw. das zum Abriss gewählte. */
  target: BulldozeTarget | null = null;
  /** Das gewählte Ziel wartet auf Bestätigung (Touchscreen). */
  pending = false;

  constructor(
    private readonly world: World,
    private readonly env: ToolEnvironment,
  ) {}

  hover(ground: Vec2 | null): void {
    if (this.pending) return;
    this.target = ground && this.pick(ground);
    this.env.changed();
  }

  tap(ground: Vec2, pointerType: string): void {
    this.target = this.pick(ground);
    // Mit der Maus sofort abreißen, auf dem Touchscreen erst nach Bestätigung.
    this.pending = this.target !== null && pointerType !== 'mouse';
    if (this.target !== null && pointerType === 'mouse') this.confirm();
    else this.env.changed();
  }

  confirm(): void {
    const target = this.target;
    if (!target) return;
    if (target.kind === 'road') demolishRoad(this.world, target.id);
    else if (target.kind === 'service') demolishService(this.world, target.id);
    else demolishBuilding(this.world, target.id);
    this.target = null;
    this.pending = false;
    this.env.worldChanged();
    this.env.changed();
  }

  cancel(): void {
    this.target = null;
    this.pending = false;
    this.env.changed();
  }

  /** Was der Abriss des gewählten Ziels zurückbringt; null ohne Auswahl. */
  get refund(): number | null {
    const target = this.target;
    if (!target) return null;
    if (target.kind === 'road') return segmentRefund(this.world, target.id);
    const service = target.kind === 'service' ? this.world.services.get(target.id) : undefined;
    return service ? serviceRefund(service.type) : 0;
  }

  get hint(): string {
    const target = this.target;
    const refund = this.refund;
    if (!target || refund === null) {
      const share = Math.round(DEMOLITION.refundShare * 100);
      return `Wähle eine Straße oder ein Gebäude zum Abreißen. Für Straßen und Dienste gibt es ${share} % zurück.`;
    }
    const confirm = this.pending ? ' Mit „Abreißen“ bestätigen.' : '';
    if (target.kind === 'building') {
      return `Der Abriss des Gebäudes kostet nichts. Bleibt die Zone, wächst dort wieder etwas.${confirm}`;
    }
    const service = target.kind === 'service' ? this.world.services.get(target.id) : undefined;
    const what = service ? SERVICE_TYPES[service.type].name : 'Die Straße';
    return `${what}: Abriss bringt ${formatMoney(refund)} zurück.${confirm}`;
  }

  /** Gebäude gehen vor: wer auf ein Grundstück zeigt, meint nicht die Straße davor. */
  private pick(ground: Vec2): BulldozeTarget | null {
    for (const service of this.world.services.values()) {
      if (onLot(service, ground)) return { kind: 'service', id: service.id };
    }
    for (const building of this.world.buildings.values()) {
      if (onLot(building, ground)) return { kind: 'building', id: building.id };
    }
    const segment = pickSegment(this.world.roads, ground, this.env.snapRadius());
    return segment === null ? null : { kind: 'road', id: segment };
  }
}
