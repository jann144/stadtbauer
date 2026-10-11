import { ROAD_TYPES, type RoadTypeId } from '../config/roads';
import { SERVICE_TYPES, type ServiceId } from '../config/services';
import { ZONE_TYPES, type ZoneId } from '../config/zones';
import type { RoadMode } from '../input/roadTool';
import type { BrushId, ZoneChoice } from '../input/zoneTool';
import { button, Choice, element } from './dom';

export type ToolId = 'view' | 'road' | 'zone' | 'service' | 'bulldoze';

export interface ToolbarHandlers {
  onTool(id: ToolId): void;
  onRoadMode(mode: RoadMode): void;
  onRoadType(type: RoadTypeId): void;
  onSnapping(on: boolean): void;
  onZone(zone: ZoneChoice): void;
  onBrush(brush: BrushId): void;
  onService(type: ServiceId): void;
  /** Die Verkehrsansicht wurde ein- oder ausgeschaltet. */
  onTrafficView(on: boolean): void;
  onConfirm(): void;
  onCancel(): void;
}

/** Untere Leiste: Werkzeugwahl, Optionen des Werkzeugs, Hinweistext und Bestätigen/Abbrechen. */
export class Toolbar {
  private readonly tools: Choice<ToolId>;
  private readonly roadMode: Choice<RoadMode>;
  private readonly roadType: Choice<RoadTypeId>;
  private readonly snapping: HTMLButtonElement;
  private readonly zone: Choice<ZoneChoice>;
  private readonly brush: Choice<BrushId>;
  private readonly service: Choice<ServiceId>;
  private readonly serviceOptions = element('div', 'panel options');
  private readonly viewOptions = element('div', 'panel options');
  private readonly trafficView: HTMLButtonElement;
  private trafficViewOn = false;
  private readonly roadOptions = element('div', 'panel options');
  private readonly zoneOptions = element('div', 'panel options');
  private readonly hint = element('div', 'panel hint');
  private readonly actions = element('div', 'actions');
  private readonly cancel: HTMLButtonElement;
  private readonly confirm: HTMLButtonElement;
  private snappingOn = true;

  constructor(root: HTMLElement, handlers: ToolbarHandlers) {
    this.tools = new Choice<ToolId>(
      [
        { id: 'view', label: 'Ansehen' },
        { id: 'road', label: 'Straße' },
        { id: 'zone', label: 'Zonen' },
        { id: 'service', label: 'Dienste' },
        { id: 'bulldoze', label: 'Abriss' },
      ],
      handlers.onTool,
    );

    this.roadMode = new Choice<RoadMode>(
      [
        { id: 'straight', label: 'Gerade' },
        { id: 'curve', label: 'Kurve' },
      ],
      handlers.onRoadMode,
    );
    const roadIds = Object.keys(ROAD_TYPES) as RoadTypeId[];
    this.roadType = new Choice<RoadTypeId>(
      roadIds.map((id) => ({ id, label: ROAD_TYPES[id].name })),
      handlers.onRoadType,
    );
    this.snapping = button('chip', 'Einrasten', () => handlers.onSnapping(!this.snappingOn));
    this.roadOptions.append(this.roadMode.element, this.roadType.element, this.snapping);

    const zoneIds = Object.keys(ZONE_TYPES) as ZoneId[];
    this.zone = new Choice<ZoneChoice>(
      [
        ...zoneIds.map((id) => ({ id, label: ZONE_TYPES[id].name, color: ZONE_TYPES[id].color })),
        { id: 'none', label: 'Entfernen' },
      ],
      handlers.onZone,
    );
    this.brush = new Choice<BrushId>(
      [
        { id: 'small', label: 'Kleiner Pinsel' },
        { id: 'large', label: 'Großer Pinsel' },
      ],
      handlers.onBrush,
    );
    this.zoneOptions.append(this.zone.element, this.brush.element);

    const serviceIds = Object.keys(SERVICE_TYPES) as ServiceId[];
    this.service = new Choice<ServiceId>(
      serviceIds.map((id) => ({ id, label: SERVICE_TYPES[id].name })),
      handlers.onService,
    );
    this.serviceOptions.append(this.service.element);

    this.trafficView = button('chip', 'Verkehr anzeigen', () => handlers.onTrafficView(!this.trafficViewOn));
    this.viewOptions.append(this.trafficView);

    this.cancel = button('action', 'Abbrechen', handlers.onCancel);
    this.confirm = button('action primary', 'Bauen', handlers.onConfirm);
    this.actions.append(this.cancel, this.confirm);

    const toolPanel = element('div', 'panel tools');
    toolPanel.append(this.tools.element);

    const bottom = element('div', 'bottom');
    bottom.append(
      this.hint,
      this.actions,
      this.viewOptions,
      this.roadOptions,
      this.zoneOptions,
      this.serviceOptions,
      toolPanel,
    );
    root.append(bottom);
  }

  setTool(id: ToolId): void {
    this.tools.set(id);
    this.viewOptions.hidden = id !== 'view';
    this.roadOptions.hidden = id !== 'road';
    this.zoneOptions.hidden = id !== 'zone';
    this.serviceOptions.hidden = id !== 'service';
  }

  setRoadOptions(mode: RoadMode, type: RoadTypeId, snapping: boolean): void {
    this.roadMode.set(mode);
    this.roadType.set(type);
    this.snappingOn = snapping;
    this.snapping.classList.toggle('active', snapping);
    this.snapping.setAttribute('aria-pressed', String(snapping));
  }

  setZoneOptions(zone: ZoneChoice, brush: BrushId): void {
    this.zone.set(zone);
    this.brush.set(brush);
  }

  setServiceOption(type: ServiceId): void {
    this.service.set(type);
  }

  setTrafficView(on: boolean): void {
    this.trafficViewOn = on;
    this.trafficView.classList.toggle('active', on);
    this.trafficView.setAttribute('aria-pressed', String(on));
  }

  /** Sperrt alles, was noch nicht freigeschaltet ist; der Vermerk nennt jeweils die Bedingung. */
  setLocks(
    roads: Record<RoadTypeId, string | null>,
    zones: Record<ZoneId, string | null>,
    services: Record<ServiceId, string | null>,
  ): void {
    for (const id of Object.keys(roads) as RoadTypeId[]) this.roadType.setLocked(id, roads[id]);
    for (const id of Object.keys(zones) as ZoneId[]) this.zone.setLocked(id, zones[id]);
    for (const id of Object.keys(services) as ServiceId[]) this.service.setLocked(id, services[id]);
  }

  /** Hinweis zum nächsten Schritt; `isProblem` färbt ihn als Fehlermeldung. */
  setHint(text: string, isProblem = false): void {
    this.hint.hidden = text === '';
    this.hint.textContent = text;
    this.hint.classList.toggle('problem', isProblem);
  }

  setActions(cancel: boolean, confirm: 'hidden' | 'disabled' | 'enabled', confirmLabel = 'Bauen'): void {
    this.cancel.hidden = !cancel;
    this.confirm.hidden = confirm === 'hidden';
    this.confirm.disabled = confirm === 'disabled';
    this.confirm.textContent = confirmLabel;
    this.actions.hidden = !cancel && confirm === 'hidden';
  }
}
