import { CATEGORY_NAMES, SERVICE_TYPES, type ServiceId } from '../config/services';
import { buildService, serviceRefusal } from '../sim/actions';
import { isServiceUnlocked } from '../sim/economy/milestones';
import { planService, type ServicePlan } from '../sim/services/services';
import type { World } from '../sim/world';
import { formatMoney } from '../util/format';
import type { Vec2 } from '../util/vec2';
import type { Tool, ToolEnvironment } from './tool';

/** Versorger und Dienste bauen: Gebäude wählen und an einen Straßenrand setzen. */
export class ServiceTool implements Tool {
  type: ServiceId = 'windTurbine';
  /** Das geplante Gebäude unter dem Zeiger bzw. an der zuletzt angetippten Stelle. */
  plan: ServicePlan | null = null;
  /** Das Gebäude wartet auf Bestätigung (Touchscreen). */
  pending = false;

  constructor(
    private readonly world: World,
    private readonly env: ToolEnvironment,
  ) {}

  setType(type: ServiceId): void {
    if (!isServiceUnlocked(this.world, type)) return;
    this.type = type;
    this.cancel();
  }

  hover(ground: Vec2 | null): void {
    if (this.pending) return;
    this.plan = ground && planService(this.world, this.type, ground);
    this.env.changed();
  }

  tap(ground: Vec2, pointerType: string): void {
    this.plan = planService(this.world, this.type, ground);
    // Mit der Maus sofort bauen, auf dem Touchscreen erst nach Bestätigung.
    this.pending = this.plan !== null && pointerType !== 'mouse';
    if (pointerType === 'mouse') this.confirm();
    this.env.changed();
  }

  confirm(): void {
    if (!this.plan || !this.canConfirm) return;
    if (buildService(this.world, this.plan) !== null) return;
    this.plan = null;
    this.pending = false;
    this.env.worldChanged();
    this.env.changed();
  }

  cancel(): void {
    this.plan = null;
    this.pending = false;
    this.env.changed();
  }

  get canConfirm(): boolean {
    return this.plan !== null && serviceRefusal(this.world, this.plan) === null;
  }

  /** Grund, warum an der gewählten Stelle nicht gebaut werden kann, oder null. */
  get problemText(): string | null {
    if (!this.plan) return null;
    // Die Prüfung läuft jedes Mal neu: seit dem Antippen kann dort ein Haus gewachsen sein.
    const refusal = serviceRefusal(this.world, this.plan);
    if (refusal === 'locked') return 'Dieses Gebäude ist noch nicht freigeschaltet.';
    if (refusal === 'blocked') return 'Hier ist kein freier Platz für das Gebäude.';
    if (refusal === 'money') {
      const have = formatMoney(this.world.economy.money);
      return `Zu teuer: ${SERVICE_TYPES[this.type].name} kostet ${formatMoney(SERVICE_TYPES[this.type].cost)}, du hast ${have}.`;
    }
    return null;
  }

  /** Was das gewählte Gebäude kostet und bewirkt. */
  get hint(): string {
    const spec = SERVICE_TYPES[this.type];
    if (!isServiceUnlocked(this.world, this.type)) return 'Noch ist kein Gebäude freigeschaltet.';
    const effect =
      spec.capacity !== undefined
        ? `Versorgt ${spec.capacity} Einwohner und Arbeitsplätze im verbundenen Straßennetz (${CATEGORY_NAMES[spec.category]}).`
        : `Wirkt ${spec.range} m weit entlang der Straßen (${CATEGORY_NAMES[spec.category]}).`;
    const price = `${spec.name}: ${formatMoney(spec.cost)}, Unterhalt ${formatMoney(spec.upkeep)} im Monat.`;
    return this.pending ? `${price} Mit „Bauen“ bestätigen oder eine andere Stelle wählen.` : `${price} ${effect}`;
  }
}
